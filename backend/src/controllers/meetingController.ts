import { Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/auth';
import { audit } from '../services/common';
import { HttpError } from '../services/feeService';
import { meetingResult, noticeCheck } from '../services/meetingService';
import { dateStr, toDate } from '../utils/dates';
import { parse, zDate, zTime } from '../utils/validate';

const actor = (req: AuthRequest) => ({ type: 'staff' as const, id: req.user!.id, name: req.user!.name });

export async function listMeetings(req: AuthRequest, res: Response) {
  const list = await prisma.meeting.findMany({
    where: { communityId: req.cid! }, orderBy: { meetingDate: 'desc' },
    include: { _count: { select: { attendance: true, motions: true } } },
  });
  res.json(list.map((m) => ({ ...m, meetingDate: dateStr(m.meetingDate), noticeDate: dateStr(m.noticeDate), notice: noticeCheck(m) })));
}

const meetingSchema = z.object({
  kind: z.enum(['OWNERS', 'COMMITTEE']).default('OWNERS'),
  reconvene: z.boolean().default(false), urgent: z.boolean().default(false),
  title: z.string().trim().min(1, '請填寫會議名稱').max(100),
  meetingDate: zDate, meetingTime: zTime.default('19:30'),
  location: z.string().trim().max(100).default(''),
  noticeDate: z.union([zDate, z.literal('')]).default(''),
  agenda: z.string().trim().max(10000).default(''), minutes: z.string().trim().max(50000).default(''),
  status: z.enum(['PLANNED', 'HELD', 'CANCELLED']).default('PLANNED'),
});

export async function saveMeeting(req: AuthRequest, res: Response) {
  const id = req.params.id;
  const b = parse(meetingSchema, req.body);
  const data = { ...b, meetingDate: toDate(b.meetingDate), noticeDate: b.noticeDate ? toDate(b.noticeDate) : null };
  let m;
  if (id) {
    if (!(await prisma.meeting.findFirst({ where: { id, communityId: req.cid! } }))) throw new HttpError(404, '找不到會議');
    m = await prisma.meeting.update({ where: { id }, data });
  } else m = await prisma.meeting.create({ data: { ...data, communityId: req.cid! } });
  await audit(req.cid, actor(req), id ? '修改會議' : '新增會議', b.title);
  res.status(id ? 200 : 201).json({ id: m.id, notice: noticeCheck(m) });
}

export async function getMeeting(req: AuthRequest, res: Response) {
  const r = await meetingResult(req.params.id, req.cid!);
  if (!r) throw new HttpError(404, '找不到會議');
  res.json(r);
}

export async function deleteMeeting(req: AuthRequest, res: Response) {
  const m = await prisma.meeting.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!m) throw new HttpError(404, '找不到會議');
  if (m.status === 'HELD') throw new HttpError(400, '已召開的會議保留紀錄，不能刪除');
  await prisma.meeting.delete({ where: { id: m.id } });
  res.json({ ok: true });
}

/** 簽到：present=false 取消簽到（同時清掉該戶已投的票） */
export async function setAttendance(req: AuthRequest, res: Response) {
  const b = parse(z.object({ unitId: z.string(), present: z.boolean(), proxy: z.string().trim().max(50).default('') }), req.body);
  const m = await prisma.meeting.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!m) throw new HttpError(404, '找不到會議');
  if (!(await prisma.unit.findFirst({ where: { id: b.unitId, communityId: req.cid!, active: true } }))) throw new HttpError(404, '找不到戶別');
  if (b.present) {
    await prisma.meetingAttendance.upsert({
      where: { meetingId_unitId: { meetingId: m.id, unitId: b.unitId } },
      create: { meetingId: m.id, unitId: b.unitId, proxy: b.proxy }, update: { proxy: b.proxy },
    });
  } else {
    await prisma.meetingAttendance.deleteMany({ where: { meetingId: m.id, unitId: b.unitId } });
    await prisma.motionVote.deleteMany({ where: { unitId: b.unitId, motion: { meetingId: m.id } } });
  }
  res.json(await meetingResult(m.id, req.cid!));
}

export async function saveMotion(req: AuthRequest, res: Response) {
  const b = parse(z.object({ title: z.string().trim().min(1, '請填寫議案').max(200), description: z.string().trim().max(5000).default(''), seq: z.coerce.number().int().min(1).optional() }), req.body);
  const m = await prisma.meeting.findFirst({ where: { id: req.params.id, communityId: req.cid! }, include: { _count: { select: { motions: true } } } });
  if (!m) throw new HttpError(404, '找不到會議');
  if (req.params.motionId) {
    await prisma.motion.updateMany({ where: { id: req.params.motionId, meetingId: m.id }, data: b });
  } else {
    await prisma.motion.create({ data: { ...b, seq: b.seq ?? m._count.motions + 1, meetingId: m.id } });
  }
  res.json(await meetingResult(m.id, req.cid!));
}

export async function deleteMotion(req: AuthRequest, res: Response) {
  const m = await prisma.meeting.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!m) throw new HttpError(404, '找不到會議');
  await prisma.motion.deleteMany({ where: { id: req.params.motionId, meetingId: m.id } });
  res.json(await meetingResult(m.id, req.cid!));
}

/** 登錄表決：votes 為 { unitId: 'YES'|'NO'|'ABSTAIN'|'' }，空字串＝清除。只有已簽到的戶別能投票。 */
export async function setVotes(req: AuthRequest, res: Response) {
  const b = parse(z.object({ votes: z.record(z.enum(['YES', 'NO', 'ABSTAIN', ''])) }), req.body);
  const mo = await prisma.motion.findFirst({ where: { id: req.params.motionId, meeting: { id: req.params.id, communityId: req.cid! } }, include: { meeting: { include: { attendance: true } } } });
  if (!mo) throw new HttpError(404, '找不到議案');
  const present = new Set(mo.meeting.attendance.map((a) => a.unitId));
  for (const [unitId, vote] of Object.entries(b.votes)) {
    if (!vote) { await prisma.motionVote.deleteMany({ where: { motionId: mo.id, unitId } }); continue; }
    if (!present.has(unitId)) throw new HttpError(400, '未簽到出席的戶別不能投票');
    await prisma.motionVote.upsert({ where: { motionId_unitId: { motionId: mo.id, unitId } }, create: { motionId: mo.id, unitId, vote }, update: { vote } });
  }
  res.json(await meetingResult(mo.meetingId, req.cid!));
}

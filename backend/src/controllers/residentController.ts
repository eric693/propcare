import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../prisma';
import { config } from '../config';
import { ResidentRequest, signResidentToken } from '../middleware/residentAuth';
import { lockedMinutes, loginFailed, loginSucceeded } from '../middleware/loginGuard';
import { audit, nextDocNo } from '../services/common';
import { createBooking, slotsOf } from '../services/bookingService';
import { HttpError, monthlyReport } from '../services/feeService';
import { bindingCode, notifyStaff } from '../services/lineService';
import { meetingResult } from '../services/meetingService';
import { addDays, dateStr, toDate, todayStr } from '../utils/dates';
import { parse, zDate, zPeriod, zTime } from '../utils/validate';

/**
 * 住戶登入：手機＋密碼（初始為手機末 6 碼）。同一支手機在多個社區都有住戶身分時，
 * 先回傳可選清單，住戶選定後帶 residentId 再登入一次。
 */
export async function residentLogin(req: Request, res: Response) {
  const b = parse(z.object({ phone: z.string().trim(), password: z.string(), residentId: z.string().optional() }), req.body);
  const key = `res:${b.phone}`;
  const locked = lockedMinutes(key);
  if (locked) { res.status(429).json({ error: `登入失敗次數過多，請 ${locked} 分鐘後再試` }); return; }
  const candidates = await prisma.resident.findMany({
    where: { phone: b.phone, active: true, password: { not: '' }, unit: { active: true }, community: { active: true }, ...(b.residentId ? { id: b.residentId } : {}) },
    include: { unit: { select: { label: true } }, community: { select: { name: true } } },
  });
  const ok = [];
  for (const r of candidates) if (await bcrypt.compare(b.password, r.password)) ok.push(r);
  if (!ok.length) { loginFailed(key); res.status(401).json({ error: '手機或密碼錯誤' }); return; }
  loginSucceeded(key);
  if (ok.length > 1) {
    res.json({ choose: ok.map((r) => ({ id: r.id, community: r.community.name, unit: r.unit.label, name: r.name })) });
    return;
  }
  const r = ok[0];
  await prisma.resident.update({ where: { id: r.id }, data: { lastLogin: new Date() } });
  res.json({ token: signResidentToken(r.id), mustChangePassword: r.mustChangePassword });
}

export async function residentMe(req: ResidentRequest, res: Response) {
  const r = req.resident!, c = req.community!;
  res.json({
    id: r.id, name: r.name, phone: r.phone, relation: r.relation, unit: { id: r.unit.id, label: r.unit.label },
    community: { id: c.id, name: c.name, phone: c.phone, bankInfo: c.bankInfo, vaBank: c.vaBank },
    vaCode: c.vaPrefix ? r.unit.vaCode : '', privacyAt: r.privacyAt,
    mustChangePassword: r.mustChangePassword, lineBound: Boolean(r.lineUserId), lineEnabled: config.line.enabled,
  });
}

export async function residentPassword(req: ResidentRequest, res: Response) {
  const b = parse(z.object({ currentPassword: z.string(), newPassword: z.string().min(8, '新密碼至少 8 碼') }), req.body);
  const r = req.resident!;
  if (config.demo.residentPhone && r.phone === config.demo.residentPhone) throw new HttpError(403, '示範帳號不能修改密碼');
  if (!(await bcrypt.compare(b.currentPassword, r.password))) throw new HttpError(400, '目前密碼不正確');
  if (b.newPassword === r.phone.slice(-6)) throw new HttpError(400, '新密碼不能和手機末 6 碼相同');
  await prisma.resident.update({ where: { id: r.id }, data: { password: await bcrypt.hash(b.newPassword, 10), mustChangePassword: false } });
  res.json({ ok: true });
}

/** 首頁一次拿齊：未繳、待領包裹、最新公告、近期預約、處理中報修 */
export async function residentHome(req: ResidentRequest, res: Response) {
  const r = req.resident!, cid = req.cid!;
  const t = todayStr();
  const [bills, packages, anns, bookings, repairs] = await Promise.all([
    prisma.feeBill.findMany({ where: { unitId: r.unitId, status: { in: ['UNPAID', 'PARTIAL'] } }, orderBy: { period: 'asc' } }),
    prisma.package.findMany({ where: { unitId: r.unitId, status: 'WAITING' }, orderBy: { receivedAt: 'desc' } }),
    visibleAnnouncements(cid, r.id, 5),
    prisma.booking.findMany({ where: { unitId: r.unitId, status: 'BOOKED', date: { gte: toDate(t) } }, include: { facility: { select: { name: true } } }, orderBy: [{ date: 'asc' }, { startTime: 'asc' }], take: 5 }),
    prisma.repair.findMany({ where: { unitId: r.unitId, status: { in: ['NEW', 'ASSIGNED', 'WORKING'] } }, orderBy: { createdAt: 'desc' } }),
  ]);
  res.json({ owed: bills.reduce((s, b) => s + b.total - b.paid, 0), bills, packages, announcements: anns, bookings, repairs });
}

async function visibleAnnouncements(cid: string, residentId: string, take?: number) {
  const t = toDate(todayStr());
  const list = await prisma.announcement.findMany({
    where: { communityId: cid, publishDate: { lte: t }, OR: [{ expireDate: null }, { expireDate: { gte: t } }] },
    include: { reads: { where: { residentId }, select: { readAt: true } } },
    orderBy: [{ pinned: 'desc' }, { publishDate: 'desc' }], take,
  });
  return list.map(({ reads, ...a }) => ({ ...a, read: reads.length > 0 }));
}

export async function residentBills(req: ResidentRequest, res: Response) {
  res.json(await prisma.feeBill.findMany({
    where: { unitId: req.resident!.unitId, status: { not: 'VOID' } },
    include: { payments: { where: { voided: false }, select: { receiptNo: true, paidDate: true, amount: true, method: true } } },
    orderBy: { period: 'desc' }, take: 36,
  }));
}

export async function residentPackages(req: ResidentRequest, res: Response) {
  res.json(await prisma.package.findMany({ where: { unitId: req.resident!.unitId }, orderBy: { receivedAt: 'desc' }, take: 50 }));
}

export async function residentAnnouncements(req: ResidentRequest, res: Response) {
  res.json(await visibleAnnouncements(req.cid!, req.resident!.id));
}

export async function readAnnouncement(req: ResidentRequest, res: Response) {
  const a = await prisma.announcement.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!a) throw new HttpError(404, '找不到公告');
  await prisma.announcementRead.upsert({
    where: { announcementId_residentId: { announcementId: a.id, residentId: req.resident!.id } },
    create: { announcementId: a.id, residentId: req.resident!.id }, update: {},
  });
  res.json({ ok: true });
}

export async function residentFacilities(req: ResidentRequest, res: Response) {
  res.json(await prisma.facility.findMany({ where: { communityId: req.cid!, active: true }, orderBy: { name: 'asc' } }));
}

/** 住戶看時段：只顯示剩餘名額，不顯示其他戶別 */
export async function residentSlots(req: ResidentRequest, res: Response) {
  const f = await prisma.facility.findFirst({ where: { id: req.params.id, communityId: req.cid!, active: true } });
  if (!f) throw new HttpError(404, '找不到設施');
  const date = parse(zDate, String(req.query.date ?? todayStr()));
  const slots = (await slotsOf(f, date)).map(({ units, ...s }) => ({ ...s, mine: units.includes(req.resident!.unit.label) }));
  res.json({ facility: f, date, maxDate: addDays(todayStr(), f.advanceDays), slots });
}

export async function residentBookings(req: ResidentRequest, res: Response) {
  res.json(await prisma.booking.findMany({
    where: { unitId: req.resident!.unitId, date: { gte: toDate(addDays(todayStr(), -30)) } },
    include: { facility: { select: { name: true } } }, orderBy: [{ date: 'desc' }, { startTime: 'desc' }],
  }));
}

export async function residentBook(req: ResidentRequest, res: Response) {
  const b = parse(z.object({ facilityId: z.string(), date: zDate, startTime: zTime, people: z.coerce.number().int().min(1).max(100).default(1), note: z.string().trim().max(200).default('') }), req.body);
  const r = req.resident!;
  res.status(201).json(await createBooking({ ...b, communityId: req.cid!, unitId: r.unitId, residentId: r.id, by: r.name }));
}

export async function residentCancelBooking(req: ResidentRequest, res: Response) {
  const bk = await prisma.booking.findFirst({ where: { id: req.params.id, unitId: req.resident!.unitId, status: 'BOOKED' } });
  if (!bk) throw new HttpError(404, '找不到預約');
  if (dateStr(bk.date) < todayStr()) throw new HttpError(400, '已過去的預約不能取消');
  await prisma.booking.update({ where: { id: bk.id }, data: { status: 'CANCELLED', note: `${bk.note}${bk.note ? '；' : ''}住戶取消` } });
  res.json({ ok: true });
}

export async function residentRepairs(req: ResidentRequest, res: Response) {
  const list = await prisma.repair.findMany({
    where: { communityId: req.cid!, OR: [{ unitId: req.resident!.unitId }, { residentId: req.resident!.id }] },
    include: { logs: { where: { public: true }, orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'desc' }, take: 50,
  });
  res.json(list.map(({ cost, vendorId, assignee, ...r }) => r));
}

export async function residentCreateRepair(req: ResidentRequest, res: Response) {
  const b = parse(z.object({
    area: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'), location: z.string().trim().max(100).default(''),
    category: z.string().trim().max(20).default('其他'), title: z.string().trim().min(1, '請填寫報修項目').max(100),
    description: z.string().trim().max(2000).default(''),
  }), req.body);
  const r = req.resident!;
  const rep = await prisma.repair.create({ data: { ...b, communityId: req.cid!, unitId: r.unitId, residentId: r.id, repairNo: await nextDocNo('R') } });
  await prisma.repairLog.create({ data: { repairId: rep.id, byName: r.name, text: '住戶線上報修' } });
  await notifyStaff(req.cid!, `【${req.community!.name}】新報修 ${rep.repairNo}\n${r.unit.label} ${r.name}：${b.location} ${b.title}`);
  await audit(req.cid, { type: 'resident', id: r.id, name: r.name }, '住戶報修', `${rep.repairNo} ${b.title}`);
  res.status(201).json(rep);
}

const repairSchema = z.object({
  area: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'), location: z.string().trim().max(100).default(''),
  category: z.string().trim().max(20).default('其他'), title: z.string().trim().min(1, '請填寫報修項目').max(100),
  description: z.string().trim().max(2000).default(''),
});

/** 住戶只能修改或撤回自己送出、管理中心還沒處理（待處理）的報修 */
async function ownNewRepair(req: ResidentRequest) {
  const r = await prisma.repair.findFirst({ where: { id: req.params.id, residentId: req.resident!.id } });
  if (!r) throw new HttpError(404, '找不到報修');
  if (r.status !== 'NEW') throw new HttpError(400, '管理中心已開始處理，請直接聯絡管理中心');
  return r;
}

export async function residentUpdateRepair(req: ResidentRequest, res: Response) {
  const r = await ownNewRepair(req);
  await prisma.repair.update({ where: { id: r.id }, data: parse(repairSchema, req.body) });
  res.json({ ok: true });
}

export async function residentDeleteRepair(req: ResidentRequest, res: Response) {
  const r = await ownNewRepair(req);
  await prisma.repair.delete({ where: { id: r.id } });
  await audit(req.cid, { type: 'resident', id: req.resident!.id, name: req.resident!.name }, '住戶撤回報修', r.repairNo);
  res.json({ ok: true });
}

/** 社區財務公開：月收支與收繳率（管委會應定期公告財務） */
export async function residentReport(req: ResidentRequest, res: Response) {
  const month = parse(zPeriod, String(req.query.month ?? todayStr().slice(0, 7)));
  const { pendingApprovals, ...r } = await monthlyReport(req.community!, month);
  res.json(r);
}

export async function residentMeetings(req: ResidentRequest, res: Response) {
  const list = await prisma.meeting.findMany({ where: { communityId: req.cid!, status: { not: 'CANCELLED' } }, orderBy: { meetingDate: 'desc' }, take: 20 });
  const out = [];
  for (const m of list) {
    const r = m.status === 'HELD' ? await meetingResult(m.id, req.cid!) : null;
    out.push({
      id: m.id, kind: m.kind, title: m.title, meetingDate: dateStr(m.meetingDate), meetingTime: m.meetingTime, location: m.location,
      agenda: m.agenda, minutes: m.status === 'HELD' ? m.minutes : '', status: m.status,
      // 不回傳逐戶投票、反對與權重，只給結果
      result: r ? { quorum: (({ weights, capped, ...q }) => q)(r.quorum), motions: r.motions.map(({ votes, objections, ...mo }) => mo) } : null,
    });
  }
  res.json(out);
}

export async function residentLineCode(req: ResidentRequest, res: Response) {
  const { code, expiry } = bindingCode();
  await prisma.resident.update({ where: { id: req.resident!.id }, data: { lineBindingCode: code, lineBindingExpiry: expiry } });
  res.json({ code, expiry, lineEnabled: config.line.enabled });
}

export async function residentLineUnbind(req: ResidentRequest, res: Response) {
  await prisma.resident.update({ where: { id: req.resident!.id }, data: { lineUserId: null } });
  res.json({ ok: true });
}

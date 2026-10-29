import { Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { prisma } from '../prisma';
import { AuthRequest, communityIdsOf } from '../middleware/auth';
import { ResidentRequest } from '../middleware/residentAuth';
import { audit } from '../services/common';
import { HttpError } from '../services/feeService';
import { notifyStaff, notifyUnit } from '../services/lineService';
import { addDays, dateStr, toDate, todayStr } from '../utils/dates';
import { parse, zDate } from '../utils/validate';
import { payUnitOldestFirst } from './feeController';

const actor = (req: AuthRequest) => ({ type: 'staff' as const, id: req.user!.id, name: req.user!.name });
const optDate = z.union([zDate, z.literal('')]).default('');
const dOrNull = (s: string) => (s ? toDate(s) : null);

async function ownUnit(cid: string, unitId: string | null | undefined) {
  if (!unitId) return null;
  const u = await prisma.unit.findFirst({ where: { id: unitId, communityId: cid } });
  if (!u) throw new HttpError(404, '找不到戶別');
  return u;
}

// ── 欠費催告送達紀錄（條例第 21 條：訴請法院前須「經定相當期間催告」）──────────

export async function listDunnings(req: AuthRequest, res: Response) {
  const unitId = req.query.unitId ? String(req.query.unitId) : undefined;
  res.json(await prisma.dunning.findMany({
    where: { communityId: req.cid!, ...(unitId ? { unitId } : {}) },
    include: { unit: { select: { label: true } } }, orderBy: { date: 'desc' }, take: 500,
  }));
}

const dunningSchema = z.object({
  unitId: z.string().min(1, '請選擇戶別'), date: zDate.default(todayStr()),
  method: z.enum(['掛號', '存證信函', '雙掛號', '親送', '公告']).default('掛號'),
  trackingNo: z.string().trim().max(50).default(''), deliveredDate: optDate, receivedBy: z.string().trim().max(50).default(''),
  amount: z.coerce.number().int().min(0).default(0), periods: z.string().trim().max(300).default(''), note: z.string().trim().max(500).default(''),
});

export async function saveDunning(req: AuthRequest, res: Response) {
  const id = req.params.id;
  const b = parse(dunningSchema, req.body);
  await ownUnit(req.cid!, b.unitId);
  const data = { ...b, date: toDate(b.date), deliveredDate: dOrNull(b.deliveredDate) };
  if (id) {
    if (!(await prisma.dunning.findFirst({ where: { id, communityId: req.cid! } }))) throw new HttpError(404, '找不到催告紀錄');
    await prisma.dunning.update({ where: { id }, data });
  } else await prisma.dunning.create({ data: { ...data, communityId: req.cid!, createdBy: req.user!.name } });
  await audit(req.cid, actor(req), id ? '修改催告紀錄' : '登錄催告寄送', `${b.method} ${b.trackingNo} ${b.amount}`);
  res.status(id ? 200 : 201).json({ ok: true });
}

export async function deleteDunning(req: AuthRequest, res: Response) {
  const d = await prisma.dunning.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!d) throw new HttpError(404, '找不到催告紀錄');
  await prisma.dunning.delete({ where: { id: d.id } });
  await audit(req.cid, actor(req), '刪除催告紀錄', `${dateStr(d.date)} ${d.method} ${d.trackingNo}`);
  res.json({ ok: true });
}

// ── 訪客登記 ─────────────────────────────────────────────────────────

export async function listVisitors(req: AuthRequest, res: Response) {
  const from = String(req.query.from ?? addDays(todayStr(), -6)), to = String(req.query.to ?? todayStr());
  const inside = req.query.inside === '1';
  res.json(await prisma.visitor.findMany({
    where: { communityId: req.cid!, ...(inside ? { outAt: null } : { inAt: { gte: new Date(`${from}T00:00:00+08:00`), lt: new Date(`${addDays(to, 1)}T00:00:00+08:00`) } }) },
    include: { unit: { select: { label: true } } }, orderBy: { inAt: 'desc' }, take: 1000,
  }));
}

const visitorSchema = z.object({
  unitId: z.string().nullable().default(null), name: z.string().trim().min(1, '請填寫訪客姓名').max(50),
  phone: z.string().trim().max(30).default(''), purpose: z.string().trim().max(30).default('拜訪'),
  headcount: z.coerce.number().int().min(1).max(100).default(1), plate: z.string().trim().max(20).default(''),
  badge: z.string().trim().max(20).default(''), note: z.string().trim().max(200).default(''),
});

export async function saveVisitor(req: AuthRequest, res: Response) {
  const id = req.params.id;
  const b = parse(visitorSchema, req.body);
  const unit = await ownUnit(req.cid!, b.unitId);
  if (id) {
    if (!(await prisma.visitor.findFirst({ where: { id, communityId: req.cid! } }))) throw new HttpError(404, '找不到訪客紀錄');
    await prisma.visitor.update({ where: { id }, data: b });
  } else {
    await prisma.visitor.create({ data: { ...b, communityId: req.cid!, createdBy: req.user!.name } });
    if (unit && b.purpose !== '外送') await notifyUnit(unit.id, `【${req.community!.name}】訪客 ${b.name}${b.headcount > 1 ? ` 等 ${b.headcount} 人` : ''}已登記來訪（${b.purpose}）。`);
  }
  res.status(id ? 200 : 201).json({ ok: true });
}

export async function visitorLeave(req: AuthRequest, res: Response) {
  const v = await prisma.visitor.findFirst({ where: { id: req.params.id, communityId: req.cid!, outAt: null } });
  if (!v) throw new HttpError(404, '找不到在場的訪客');
  await prisma.visitor.update({ where: { id: v.id }, data: { outAt: new Date() } });
  res.json({ ok: true });
}

export async function deleteVisitor(req: AuthRequest, res: Response) {
  const v = await prisma.visitor.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!v) throw new HttpError(404, '找不到訪客紀錄');
  await prisma.visitor.delete({ where: { id: v.id } });
  await audit(req.cid, actor(req), '刪除訪客紀錄', v.name);
  res.json({ ok: true });
}

// ── 意見反映 ─────────────────────────────────────────────────────────

export const FEEDBACK_CATEGORIES = ['建議', '抱怨', '噪音', '環境清潔', '停車', '寵物', '其他'];

export async function listFeedback(req: AuthRequest, res: Response) {
  res.json(await prisma.feedback.findMany({
    where: { communityId: req.cid! }, include: { unit: { select: { label: true } }, resident: { select: { name: true, phone: true } } },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 500,
  }));
}

export async function replyFeedback(req: AuthRequest, res: Response) {
  const b = parse(z.object({ reply: z.string().trim().max(2000).default(''), status: z.enum(['OPEN', 'REPLIED', 'CLOSED']) }), req.body);
  const f = await prisma.feedback.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!f) throw new HttpError(404, '找不到意見');
  const replied = b.reply && b.reply !== f.reply;
  await prisma.feedback.update({ where: { id: f.id }, data: { ...b, ...(replied ? { repliedBy: req.user!.name, repliedAt: new Date() } : {}) } });
  if (replied) await notifyUnit(f.unitId, `【${req.community!.name}】管理中心已回覆您的意見「${f.title}」：\n${b.reply.slice(0, 300)}`);
  await audit(req.cid, actor(req), '回覆意見', f.title);
  res.json({ ok: true });
}

export async function deleteFeedback(req: AuthRequest, res: Response) {
  const f = await prisma.feedback.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!f) throw new HttpError(404, '找不到意見');
  await prisma.feedback.delete({ where: { id: f.id } });
  await audit(req.cid, actor(req), '刪除意見', f.title);
  res.json({ ok: true });
}

export async function residentFeedback(req: ResidentRequest, res: Response) {
  res.json(await prisma.feedback.findMany({ where: { unitId: req.resident!.unitId }, orderBy: { createdAt: 'desc' }, take: 100 }));
}

export async function residentCreateFeedback(req: ResidentRequest, res: Response) {
  const b = parse(z.object({
    category: z.enum(FEEDBACK_CATEGORIES as [string, ...string[]]).default('建議'),
    title: z.string().trim().min(1, '請填寫主旨').max(100), content: z.string().trim().max(3000).default(''),
  }), req.body);
  const r = req.resident!;
  const f = await prisma.feedback.create({ data: { ...b, communityId: req.cid!, unitId: r.unitId, residentId: r.id } });
  await notifyStaff(req.cid!, `【${req.community!.name}】住戶意見（${b.category}）\n${r.unit.label}：${b.title}`);
  await audit(req.cid, { type: 'resident', id: r.id, name: r.name }, '住戶提出意見', b.title);
  res.status(201).json(f);
}

export async function residentDeleteFeedback(req: ResidentRequest, res: Response) {
  const f = await prisma.feedback.findFirst({ where: { id: req.params.id, residentId: req.resident!.id, status: 'OPEN', reply: '' } });
  if (!f) throw new HttpError(400, '只能撤回自己送出、尚未回覆的意見');
  await prisma.feedback.delete({ where: { id: f.id } });
  res.json({ ok: true });
}

// ── 社區文件（規約、圖說、會議附件；條例第 35 條利害關係人得閱覽）────────

const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');
const ALLOWED = /^(application\/pdf|image\/(png|jpeg|webp)|application\/(msword|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet))|application\/vnd\.ms-excel|text\/plain)$/;

export async function listDocuments(req: AuthRequest, res: Response) {
  res.json(await prisma.document.findMany({ where: { communityId: req.cid! }, orderBy: [{ category: 'asc' }, { createdAt: 'desc' }] }));
}

export async function uploadDocument(req: AuthRequest, res: Response) {
  const b = parse(z.object({
    title: z.string().trim().min(1, '請填寫文件名稱').max(100), category: z.string().trim().max(20).default('規約'),
    forResidents: z.boolean().default(true), fileName: z.string().trim().min(1).max(200),
    mime: z.string().max(100), data: z.string().min(1, '請選擇檔案'),
  }), req.body);
  if (!ALLOWED.test(b.mime)) throw new HttpError(400, '只接受 PDF、圖片、Word、Excel 或文字檔');
  const buf = Buffer.from(b.data, 'base64');
  if (buf.length > 10 * 1024 * 1024) throw new HttpError(400, '檔案不可超過 10 MB');
  const dir = path.join(UPLOAD_DIR, req.cid!);
  fs.mkdirSync(dir, { recursive: true });
  const storedName = crypto.randomBytes(12).toString('hex') + path.extname(b.fileName).toLowerCase().replace(/[^.a-z0-9]/g, '');
  fs.writeFileSync(path.join(dir, storedName), buf);
  const d = await prisma.document.create({ data: { communityId: req.cid!, title: b.title, category: b.category, forResidents: b.forResidents, fileName: b.fileName, storedName, mime: b.mime, size: buf.length, createdBy: req.user!.name } });
  await audit(req.cid, actor(req), '上傳文件', b.title);
  res.status(201).json(d);
}

export async function updateDocument(req: AuthRequest, res: Response) {
  const b = parse(z.object({ title: z.string().trim().min(1).max(100), category: z.string().trim().max(20), forResidents: z.boolean() }), req.body);
  const d = await prisma.document.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!d) throw new HttpError(404, '找不到文件');
  await prisma.document.update({ where: { id: d.id }, data: b });
  res.json({ ok: true });
}

export async function deleteDocument(req: AuthRequest, res: Response) {
  const d = await prisma.document.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!d) throw new HttpError(404, '找不到文件');
  await prisma.document.delete({ where: { id: d.id } });
  fs.rmSync(path.join(UPLOAD_DIR, d.communityId, d.storedName), { force: true });
  await audit(req.cid, actor(req), '刪除文件', d.title);
  res.json({ ok: true });
}

function sendDoc(res: Response, d: { communityId: string; storedName: string; fileName: string; mime: string }) {
  const file = path.join(UPLOAD_DIR, d.communityId, d.storedName);
  if (!fs.existsSync(file)) throw new HttpError(404, '檔案已不存在');
  res.setHeader('Content-Type', d.mime);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(d.fileName)}`);
  res.sendFile(file);
}

export async function downloadDocument(req: AuthRequest, res: Response) {
  const d = await prisma.document.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!d) throw new HttpError(404, '找不到文件');
  sendDoc(res, d);
}

export async function residentDocuments(req: ResidentRequest, res: Response) {
  res.json(await prisma.document.findMany({ where: { communityId: req.cid!, forResidents: true }, select: { id: true, title: true, category: true, fileName: true, size: true, createdAt: true }, orderBy: [{ category: 'asc' }, { createdAt: 'desc' }] }));
}

export async function residentDownloadDocument(req: ResidentRequest, res: Response) {
  const d = await prisma.document.findFirst({ where: { id: req.params.id, communityId: req.cid!, forResidents: true } });
  if (!d) throw new HttpError(404, '找不到文件');
  sendDoc(res, d);
}

// ── 住戶意見調查（一戶一票；非區分所有權人會議的法定表決）──────────────

function pollSummary(p: { options: unknown; votes: { option: number }[] }) {
  const options = p.options as string[];
  const counts = options.map((_, i) => p.votes.filter((v) => v.option === i).length);
  return { options, counts, total: p.votes.length };
}

export async function listPolls(req: AuthRequest, res: Response) {
  const units = await prisma.unit.count({ where: { communityId: req.cid!, active: true } });
  const polls = await prisma.poll.findMany({ where: { communityId: req.cid! }, include: { votes: { select: { option: true } } }, orderBy: { createdAt: 'desc' } });
  res.json({ units, polls: polls.map(({ votes, ...p }) => ({ ...p, endDate: dateStr(p.endDate), ...pollSummary({ options: p.options, votes }) })) });
}

const pollSchema = z.object({
  title: z.string().trim().min(1, '請填寫調查主題').max(100), description: z.string().trim().max(3000).default(''),
  options: z.array(z.string().trim().min(1).max(50)).min(2, '至少要有 2 個選項').max(10),
  endDate: zDate, showResult: z.boolean().default(true),
});

export async function savePoll(req: AuthRequest, res: Response) {
  const id = req.params.id;
  const b = parse(pollSchema, req.body);
  const data = { ...b, endDate: toDate(b.endDate) };
  if (id) {
    const p = await prisma.poll.findFirst({ where: { id, communityId: req.cid! }, include: { _count: { select: { votes: true } } } });
    if (!p) throw new HttpError(404, '找不到調查');
    if (p._count.votes && JSON.stringify(p.options) !== JSON.stringify(b.options)) throw new HttpError(400, '已有住戶作答，不能修改選項');
    await prisma.poll.update({ where: { id }, data });
  } else await prisma.poll.create({ data: { ...data, communityId: req.cid!, createdBy: req.user!.name } });
  await audit(req.cid, actor(req), id ? '修改意見調查' : '發起意見調查', b.title);
  res.status(id ? 200 : 201).json({ ok: true });
}

export async function deletePoll(req: AuthRequest, res: Response) {
  const p = await prisma.poll.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!p) throw new HttpError(404, '找不到調查');
  await prisma.poll.delete({ where: { id: p.id } });
  await audit(req.cid, actor(req), '刪除意見調查', p.title);
  res.json({ ok: true });
}

export async function residentPolls(req: ResidentRequest, res: Response) {
  const polls = await prisma.poll.findMany({ where: { communityId: req.cid! }, include: { votes: { select: { option: true, unitId: true } } }, orderBy: { createdAt: 'desc' }, take: 30 });
  const t = todayStr();
  res.json(polls.map(({ votes, ...p }) => {
    const open = dateStr(p.endDate) >= t;
    const mine = votes.find((v) => v.unitId === req.resident!.unitId)?.option ?? null;
    const s = pollSummary({ options: p.options, votes });
    return { id: p.id, title: p.title, description: p.description, endDate: dateStr(p.endDate), open, mine, options: s.options, ...(p.showResult || !open ? { counts: s.counts, total: s.total } : {}) };
  }));
}

export async function residentVote(req: ResidentRequest, res: Response) {
  const b = parse(z.object({ option: z.coerce.number().int().min(0) }), req.body);
  const p = await prisma.poll.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!p) throw new HttpError(404, '找不到調查');
  if (dateStr(p.endDate) < todayStr()) throw new HttpError(400, '調查已截止');
  if (b.option >= (p.options as string[]).length) throw new HttpError(400, '選項不正確');
  const r = req.resident!;
  await prisma.pollVote.upsert({
    where: { pollId_unitId: { pollId: p.id, unitId: r.unitId } },
    create: { pollId: p.id, unitId: r.unitId, option: b.option, residentId: r.id }, update: { option: b.option, residentId: r.id, votedAt: new Date() },
  });
  res.json({ ok: true });
}

// ── 社區財產清冊 ─────────────────────────────────────────────────────

export async function listAssets(req: AuthRequest, res: Response) {
  res.json(await prisma.asset.findMany({ where: { communityId: req.cid! }, orderBy: [{ category: 'asc' }, { assetNo: 'asc' }, { name: 'asc' }] }));
}

const assetSchema = z.object({
  assetNo: z.string().trim().max(30).default(''), name: z.string().trim().min(1, '請填寫財產名稱').max(100),
  category: z.string().trim().max(20).default('設備'), location: z.string().trim().max(50).default(''),
  quantity: z.coerce.number().int().min(0).max(100000).default(1), purchaseDate: optDate,
  cost: z.coerce.number().int().min(0).default(0), status: z.enum(['IN_USE', 'REPAIR', 'IDLE', 'SCRAPPED']).default('IN_USE'),
  keeper: z.string().trim().max(50).default(''), note: z.string().trim().max(500).default(''),
});

export async function saveAsset(req: AuthRequest, res: Response) {
  const id = req.params.id;
  const b = parse(assetSchema, req.body);
  const data = { ...b, purchaseDate: dOrNull(b.purchaseDate) };
  if (id) {
    if (!(await prisma.asset.findFirst({ where: { id, communityId: req.cid! } }))) throw new HttpError(404, '找不到財產');
    await prisma.asset.update({ where: { id }, data });
  } else await prisma.asset.create({ data: { ...data, communityId: req.cid! } });
  await audit(req.cid, actor(req), id ? '修改財產' : '新增財產', b.name);
  res.status(id ? 200 : 201).json({ ok: true });
}

export async function deleteAsset(req: AuthRequest, res: Response) {
  const a = await prisma.asset.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!a) throw new HttpError(404, '找不到財產');
  await prisma.asset.delete({ where: { id: a.id } });
  await audit(req.cid, actor(req), '刪除財產', a.name);
  res.json({ ok: true });
}

// ── 巡邏打卡 ─────────────────────────────────────────────────────────

export async function listPatrol(req: AuthRequest, res: Response) {
  const date = String(req.query.date ?? todayStr());
  const [points, logs] = await Promise.all([
    prisma.patrolPoint.findMany({ where: { communityId: req.cid! }, orderBy: [{ seq: 'asc' }, { name: 'asc' }] }),
    prisma.patrolLog.findMany({
      where: { communityId: req.cid!, scannedAt: { gte: new Date(`${date}T00:00:00+08:00`), lt: new Date(`${addDays(date, 1)}T00:00:00+08:00`) } },
      include: { point: { select: { name: true } } }, orderBy: { scannedAt: 'desc' },
    }),
  ]);
  res.json({ points, logs });
}

const pointSchema = z.object({ name: z.string().trim().min(1, '請填寫巡邏點名稱').max(50), location: z.string().trim().max(100).default(''), seq: z.coerce.number().int().min(1).max(999).default(1), active: z.boolean().default(true) });

export async function savePatrolPoint(req: AuthRequest, res: Response) {
  const id = req.params.id;
  const b = parse(pointSchema, req.body);
  if (id) {
    if (!(await prisma.patrolPoint.findFirst({ where: { id, communityId: req.cid! } }))) throw new HttpError(404, '找不到巡邏點');
    await prisma.patrolPoint.update({ where: { id }, data: b });
  } else await prisma.patrolPoint.create({ data: { ...b, communityId: req.cid!, code: crypto.randomBytes(9).toString('base64url') } });
  res.status(id ? 200 : 201).json({ ok: true });
}

export async function deletePatrolPoint(req: AuthRequest, res: Response) {
  const p = await prisma.patrolPoint.findFirst({ where: { id: req.params.id, communityId: req.cid! }, include: { _count: { select: { logs: true } } } });
  if (!p) throw new HttpError(404, '找不到巡邏點');
  if (p._count.logs) await prisma.patrolPoint.update({ where: { id: p.id }, data: { active: false } });
  else await prisma.patrolPoint.delete({ where: { id: p.id } });
  res.json({ ok: true, deactivated: p._count.logs > 0 });
}

/** 掃描巡邏點 QR Code 打卡：巡邏點須屬於登入者可管理的社區（不需先選社區） */
export async function patrolScan(req: AuthRequest, res: Response) {
  const b = parse(z.object({ code: z.string().trim().min(1).max(40), note: z.string().trim().max(200).default('') }), req.body);
  const p = await prisma.patrolPoint.findUnique({ where: { code: b.code }, include: { community: { select: { name: true } } } });
  if (!p || !p.active) throw new HttpError(404, '找不到這個巡邏點，或已停用');
  if (!(await communityIdsOf(req.user!)).includes(p.communityId)) throw new HttpError(403, '您沒有這個社區的權限');
  const last = await prisma.patrolLog.findFirst({ where: { pointId: p.id, userName: req.user!.name }, orderBy: { scannedAt: 'desc' } });
  if (last && Date.now() - last.scannedAt.getTime() < 60_000) throw new HttpError(409, '一分鐘內已在這個點打過卡');
  const log = await prisma.patrolLog.create({ data: { communityId: p.communityId, pointId: p.id, userName: req.user!.name, note: b.note } });
  res.status(201).json({ point: p.name, community: p.community.name, scannedAt: log.scannedAt });
}

// ── 銀行入帳匯入：依虛擬帳號比對戶別，整戶由最舊帳單沖銷 ─────────────────

interface BankRow { line: number; date: string; amount: number; account: string; memo: string; hash: string; unitId: string | null; unitLabel: string; owed: number; duplicate: boolean; problem: string }

/** 解析日期：2026/10/29、2026-10-29、20261029、民國 115/10/29、1151029 */
function parseBankDate(s: string): string {
  const t = s.trim();
  let m = t.match(/^(\d{3,4})[/.-](\d{1,2})[/.-](\d{1,2})/);
  if (!m) { const d = t.match(/^(\d{3,4})(\d{2})(\d{2})$/); if (d) m = d; }
  if (!m) return '';
  let y = Number(m[1]);
  if (y < 1911) y += 1911;
  const mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 切欄位：有 Tab 用 Tab；否則依 CSV 規則（引號內的逗號不切，例如 "1,200"） */
function splitCells(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((c) => c.replace(/^"|"$/g, '').trim());
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export async function bankPreview(req: AuthRequest, res: Response) {
  const { text } = parse(z.object({ text: z.string().min(1, '請貼上或選擇銀行入帳明細').max(2_000_000) }), req.body);
  const units = await prisma.unit.findMany({ where: { communityId: req.cid! }, select: { id: true, label: true, vaCode: true } });
  const byVa = new Map(units.filter((u) => u.vaCode).map((u) => [u.vaCode, u]));
  const owedRows = await prisma.feeBill.groupBy({ by: ['unitId'], where: { communityId: req.cid!, status: { in: ['UNPAID', 'PARTIAL'] } }, _sum: { total: true, paid: true } });
  const owed = new Map(owedRows.map((r) => [r.unitId, (r._sum.total ?? 0) - (r._sum.paid ?? 0)]));
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const header = splitCells(lines[0] ?? '');
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const hDate = col(/日期|交易日|入帳日/), hAmt = col(/存入|入帳金額|金額|收入/), hAcct = col(/虛擬帳號|帳號|銷帳編號|繳款編號/), hMemo = col(/備註|摘要|附言|說明/);
  const useHeader = hDate >= 0 && hAmt >= 0;
  const seen = new Map<string, number>();
  const rows: BankRow[] = [];
  lines.forEach((raw, i) => {
    if (!raw.trim() || (useHeader && i === 0)) return;
    const cells = splitCells(raw);
    let date = '', amount = 0, account = '', memo = '';
    if (useHeader) {
      date = parseBankDate(cells[hDate] ?? '');
      amount = Math.round(Number((cells[hAmt] ?? '').replace(/,/g, '')) || 0);
      account = hAcct >= 0 ? (cells[hAcct] ?? '').replace(/\D/g, '') : '';
      memo = hMemo >= 0 ? cells[hMemo] ?? '' : '';
    } else {
      // 沒有標題列：取第一個像日期的欄位、10 碼以上的數字為帳號、其餘第一個正數為金額
      for (const c of cells) {
        if (!date && parseBankDate(c)) { date = parseBankDate(c); continue; }
        const digits = c.replace(/\D/g, '');
        if (!account && /^\d{10,16}$/.test(c.replace(/[\s-]/g, ''))) { account = digits; continue; }
        const n = Number(c.replace(/,/g, ''));
        if (!amount && /^[\d,]+(\.\d+)?$/.test(c) && n > 0) { amount = Math.round(n); continue; }
        if (c && !memo) memo = c;
      }
    }
    if (!account) account = (memo.match(/\d{10,16}/) ?? [''])[0];
    const unit = byVa.get(account) ?? units.find((u) => u.vaCode && account.endsWith(u.vaCode)) ?? null;
    const key = `${date}|${amount}|${account}|${memo}`;
    const n = (seen.get(key) ?? 0) + 1; seen.set(key, n);
    const hash = crypto.createHash('sha1').update(`${key}|${n}`).digest('hex');
    const problem = !date ? '看不懂日期' : amount <= 0 ? '看不懂金額' : !unit ? '找不到對應的虛擬帳號，請手動選擇戶別' : '';
    rows.push({ line: i + 1, date, amount, account, memo, hash, unitId: unit?.id ?? null, unitLabel: unit?.label ?? '', owed: unit ? owed.get(unit.id) ?? 0 : 0, duplicate: false, problem });
  });
  const dup = await prisma.bankTxn.findMany({ where: { communityId: req.cid!, hash: { in: rows.map((r) => r.hash) } }, select: { hash: true } });
  const dupSet = new Set(dup.map((d) => d.hash));
  for (const r of rows) if (dupSet.has(r.hash)) { r.duplicate = true; r.problem = '這筆已經匯入過'; }
  res.json({ rows, header: useHeader ? header : null });
}

export async function bankApply(req: AuthRequest, res: Response) {
  const b = parse(z.object({ rows: z.array(z.object({
    hash: z.string().length(40), date: zDate, amount: z.coerce.number().int().positive(), account: z.string().max(30).default(''),
    memo: z.string().max(200).default(''), unitId: z.string().min(1),
  })).min(1, '沒有要入帳的資料').max(2000) }), req.body);
  const results: { hash: string; ok: boolean; receipts?: string[]; error?: string }[] = [];
  for (const r of b.rows) {
    try {
      await ownUnit(req.cid!, r.unitId);
      if (await prisma.bankTxn.findUnique({ where: { communityId_hash: { communityId: req.cid!, hash: r.hash } } })) throw new HttpError(409, '這筆已經匯入過');
      const receipts = await payUnitOldestFirst({ communityId: req.cid!, unitId: r.unitId, amount: r.amount, method: 'ATM', paidDate: r.date, note: `銀行入帳 ${r.account}`.trim(), by: req.user!.name });
      await prisma.bankTxn.create({ data: { communityId: req.cid!, hash: r.hash, date: toDate(r.date), amount: r.amount, account: r.account, memo: r.memo, unitId: r.unitId, receiptNos: receipts.join(','), createdBy: req.user!.name } });
      results.push({ hash: r.hash, ok: true, receipts });
    } catch (e) {
      results.push({ hash: r.hash, ok: false, error: e instanceof HttpError ? e.message : '入帳失敗' });
    }
  }
  const ok = results.filter((r) => r.ok).length;
  await audit(req.cid, actor(req), '匯入銀行入帳', `成功 ${ok} 筆、失敗 ${results.length - ok} 筆`);
  res.json({ results });
}

// ── 匯出紀錄（個資法：個人資料的利用留存軌跡）───────────────────────────

export async function logExport(req: AuthRequest, res: Response) {
  const b = parse(z.object({ what: z.string().trim().min(1).max(50), rows: z.coerce.number().int().min(0).default(0) }), req.body);
  await audit(req.cid, actor(req), '匯出資料', `${b.what}（${b.rows} 筆）`);
  res.json({ ok: true });
}

// ── 住戶同意個資告知 ─────────────────────────────────────────────────

export async function residentPrivacy(req: ResidentRequest, res: Response) {
  await prisma.resident.update({ where: { id: req.resident!.id }, data: { privacyAt: new Date() } });
  res.json({ ok: true });
}

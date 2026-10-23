import { Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/auth';
import { audit, newPickupCode, nextDocNo } from '../services/common';
import { createBooking, slotsOf } from '../services/bookingService';
import { HttpError } from '../services/feeService';
import { notifyCommunity, notifyStaff, notifyUnit } from '../services/lineService';
import { addDays, toDate, todayStr } from '../utils/dates';
import { parse, zDate, zTime } from '../utils/validate';

const actor = (req: AuthRequest) => ({ type: 'staff' as const, id: req.user!.id, name: req.user!.name });
const PKG_KIND: Record<string, string> = { PARCEL: '包裹', MAIL: '信件', REGISTERED: '掛號信', COLD: '冷藏包裹', LARGE: '大型包裹' };

// ── 包裹代收 ─────────────────────────────────────────────────────────

export async function listPackages(req: AuthRequest, res: Response) {
  const status = String(req.query.status ?? 'WAITING');
  const q = String(req.query.q ?? '').trim();
  res.json(await prisma.package.findMany({
    where: {
      communityId: req.cid!, ...(status !== 'ALL' ? { status: status as never } : {}),
      ...(q ? { OR: [{ pickupCode: q }, { trackingNo: { contains: q } }, { recipient: { contains: q } }, { unit: { label: { contains: q } } }] } : {}),
    },
    include: { unit: { select: { label: true } } },
    orderBy: { receivedAt: 'desc' }, take: 500,
  }));
}

export async function createPackage(req: AuthRequest, res: Response) {
  const b = parse(z.object({
    unitId: z.string().min(1, '請選擇戶別'), recipient: z.string().trim().max(50).default(''),
    carrier: z.string().trim().max(30).default(''), trackingNo: z.string().trim().max(50).default(''),
    kind: z.enum(['PARCEL', 'MAIL', 'REGISTERED', 'COLD', 'LARGE']).default('PARCEL'),
    shelf: z.string().trim().max(20).default(''), note: z.string().trim().max(200).default(''),
    count: z.coerce.number().int().min(1).max(20).default(1),
  }), req.body);
  const unit = await prisma.unit.findFirst({ where: { id: b.unitId, communityId: req.cid!, active: true } });
  if (!unit) throw new HttpError(404, '找不到戶別');
  const { count, ...data } = b;
  const created = [];
  for (let i = 0; i < count; i++) {
    created.push(await prisma.package.create({ data: { ...data, communityId: req.cid!, pickupCode: await newPickupCode(req.cid!), receivedBy: req.user!.name } }));
  }
  const codes = created.map((p) => p.pickupCode).join('、');
  const n = await notifyUnit(unit.id, `【${req.community!.name}】管理中心已代收您的${PKG_KIND[b.kind]} ${count} 件${b.carrier ? `（${b.carrier}）` : ''}\n取件碼：${codes}\n請攜帶取件碼至管理中心領取。`);
  if (n) await prisma.package.updateMany({ where: { id: { in: created.map((p) => p.id) } }, data: { notified: true } });
  res.status(201).json({ packages: created, notified: n });
}

/** 領取：可用 id 或取件碼 */
export async function pickupPackage(req: AuthRequest, res: Response) {
  const b = parse(z.object({ id: z.string().optional(), code: z.string().trim().optional(), pickedBy: z.string().trim().max(50).default('') }), req.body);
  const p = await prisma.package.findFirst({
    where: { communityId: req.cid!, status: 'WAITING', ...(b.id ? { id: b.id } : { pickupCode: b.code ?? '-' }) },
    include: { unit: { select: { label: true } } },
  });
  if (!p) throw new HttpError(404, b.code ? `找不到取件碼 ${b.code} 的待領包裹` : '找不到待領包裹');
  await prisma.package.update({ where: { id: p.id }, data: { status: 'PICKED', pickedAt: new Date(), pickedBy: b.pickedBy || p.recipient } });
  await audit(req.cid, actor(req), '包裹領取', `${p.unit.label} ${p.pickupCode}`);
  res.json({ ok: true, package: p });
}

export async function updatePackage(req: AuthRequest, res: Response) {
  const b = parse(z.object({
    unitId: z.string().min(1, '請選擇戶別'), recipient: z.string().trim().max(50).default(''),
    carrier: z.string().trim().max(30).default(''), trackingNo: z.string().trim().max(50).default(''),
    kind: z.enum(['PARCEL', 'MAIL', 'REGISTERED', 'COLD', 'LARGE']).default('PARCEL'),
    shelf: z.string().trim().max(20).default(''), note: z.string().trim().max(200).default(''),
  }), req.body);
  const p = await prisma.package.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!p) throw new HttpError(404, '找不到包裹');
  if (!(await prisma.unit.findFirst({ where: { id: b.unitId, communityId: req.cid!, active: true } }))) throw new HttpError(404, '找不到戶別');
  await prisma.package.update({ where: { id: p.id }, data: b });
  res.json({ ok: true });
}

/** 刪除包裹登記（登記錯誤時用；已領取的保留紀錄不能刪） */
export async function deletePackage(req: AuthRequest, res: Response) {
  const p = await prisma.package.findFirst({ where: { id: req.params.id, communityId: req.cid! }, include: { unit: { select: { label: true } } } });
  if (!p) throw new HttpError(404, '找不到包裹');
  if (p.status === 'PICKED') throw new HttpError(400, '已領取的包裹保留紀錄，不能刪除');
  await prisma.package.delete({ where: { id: p.id } });
  await audit(req.cid, actor(req), '刪除包裹登記', `${p.unit.label} ${p.pickupCode}`);
  res.json({ ok: true });
}

export async function returnPackage(req: AuthRequest, res: Response) {
  const p = await prisma.package.findFirst({ where: { id: req.params.id, communityId: req.cid!, status: 'WAITING' } });
  if (!p) throw new HttpError(404, '找不到待領包裹');
  await prisma.package.update({ where: { id: p.id }, data: { status: 'RETURNED', pickedAt: new Date(), note: `${p.note}${p.note ? '；' : ''}已退回` } });
  res.json({ ok: true });
}

// ── 公共設施與預約 ───────────────────────────────────────────────────

const facilitySchema = z.object({
  name: z.string().trim().min(1, '請填寫設施名稱').max(40),
  openTime: zTime.default('08:00'), closeTime: zTime.default('22:00'),
  slotMinutes: z.coerce.number().int().min(15).max(480).default(60),
  capacity: z.coerce.number().int().min(1).max(200).default(1),
  maxPerWeek: z.coerce.number().int().min(0).max(50).default(0),
  advanceDays: z.coerce.number().int().min(0).max(90).default(14),
  fee: z.coerce.number().int().min(0).default(0),
  rules: z.string().trim().max(1000).default(''),
  active: z.boolean().default(true),
});

export async function listFacilities(req: AuthRequest, res: Response) {
  res.json(await prisma.facility.findMany({ where: { communityId: req.cid! }, orderBy: { name: 'asc' } }));
}

export async function saveFacility(req: AuthRequest, res: Response) {
  const id = req.params.id;
  const b = parse(facilitySchema, req.body);
  if (b.openTime >= b.closeTime) throw new HttpError(400, '開放時間須早於結束時間');
  if (id) {
    if (!(await prisma.facility.findFirst({ where: { id, communityId: req.cid! } }))) throw new HttpError(404, '找不到設施');
    await prisma.facility.update({ where: { id }, data: b });
  } else await prisma.facility.create({ data: { ...b, communityId: req.cid! } });
  res.status(id ? 200 : 201).json({ ok: true });
}

/** 刪除設施：有預約紀錄的設施改為停用，保留歷史 */
export async function deleteFacility(req: AuthRequest, res: Response) {
  const f = await prisma.facility.findFirst({ where: { id: req.params.id, communityId: req.cid! }, include: { _count: { select: { bookings: true } } } });
  if (!f) throw new HttpError(404, '找不到設施');
  if (f._count.bookings) {
    await prisma.facility.update({ where: { id: f.id }, data: { active: false } });
    await prisma.booking.updateMany({ where: { facilityId: f.id, status: 'BOOKED', date: { gte: toDate(todayStr()) } }, data: { status: 'CANCELLED', note: '設施停用' } });
    res.json({ ok: true, deactivated: true }); return;
  }
  await prisma.facility.delete({ where: { id: f.id } });
  res.json({ ok: true, deactivated: false });
}

export async function facilitySlots(req: AuthRequest, res: Response) {
  const f = await prisma.facility.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!f) throw new HttpError(404, '找不到設施');
  const date = parse(zDate, String(req.query.date ?? todayStr()));
  res.json({ facility: f, date, slots: await slotsOf(f, date) });
}

export async function listBookings(req: AuthRequest, res: Response) {
  const from = String(req.query.from ?? todayStr()), to = String(req.query.to ?? addDays(from, 14));
  res.json(await prisma.booking.findMany({
    where: { communityId: req.cid!, date: { gte: toDate(from), lte: toDate(to) } },
    include: { facility: { select: { name: true } }, unit: { select: { label: true } }, resident: { select: { name: true } } },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  }));
}

export async function staffBooking(req: AuthRequest, res: Response) {
  const b = parse(z.object({ facilityId: z.string(), unitId: z.string(), date: zDate, startTime: zTime, people: z.coerce.number().int().min(1).default(1), note: z.string().trim().max(200).default('') }), req.body);
  if (!(await prisma.unit.findFirst({ where: { id: b.unitId, communityId: req.cid! } }))) throw new HttpError(404, '找不到戶別');
  res.status(201).json(await createBooking({ ...b, communityId: req.cid!, by: req.user!.name }));
}

/** 改期：取消原預約、依同樣規則重新預約；新時段不行就還原 */
export async function updateBooking(req: AuthRequest, res: Response) {
  const b = parse(z.object({ facilityId: z.string(), unitId: z.string(), date: zDate, startTime: zTime, people: z.coerce.number().int().min(1).default(1), note: z.string().trim().max(200).default('') }), req.body);
  const old = await prisma.booking.findFirst({ where: { id: req.params.id, communityId: req.cid!, status: 'BOOKED' } });
  if (!old) throw new HttpError(404, '找不到預約');
  if (!(await prisma.unit.findFirst({ where: { id: b.unitId, communityId: req.cid! } }))) throw new HttpError(404, '找不到戶別');
  await prisma.booking.update({ where: { id: old.id }, data: { status: 'CANCELLED' } });
  try {
    const nb = await createBooking({ ...b, communityId: req.cid!, residentId: old.unitId === b.unitId ? old.residentId ?? undefined : undefined, by: req.user!.name });
    await prisma.booking.update({ where: { id: old.id }, data: { note: `${old.note}${old.note ? '；' : ''}已改期` } });
    res.json(nb);
  } catch (e) {
    await prisma.booking.update({ where: { id: old.id }, data: { status: 'BOOKED' } });
    throw e;
  }
}

export async function cancelBooking(req: AuthRequest, res: Response) {
  const bk = await prisma.booking.findFirst({ where: { id: req.params.id, communityId: req.cid!, status: 'BOOKED' } });
  if (!bk) throw new HttpError(404, '找不到預約');
  await prisma.booking.update({ where: { id: bk.id }, data: { status: 'CANCELLED', note: `${bk.note}${bk.note ? '；' : ''}管理中心取消` } });
  res.json({ ok: true });
}

// ── 報修 ─────────────────────────────────────────────────────────────

export const REPAIR_CATEGORIES = ['水電', '電梯', '門禁對講', '消防', '照明', '漏水', '公設損壞', '清潔環境', '停車場', '其他'];

export async function listRepairs(req: AuthRequest, res: Response) {
  const status = String(req.query.status ?? 'OPEN');
  const statusWhere = status === 'OPEN' ? { status: { in: ['NEW', 'ASSIGNED', 'WORKING'] as never[] } } : status === 'ALL' ? {} : { status: status as never };
  res.json(await prisma.repair.findMany({
    where: { communityId: req.cid!, ...statusWhere },
    include: { unit: { select: { label: true } }, resident: { select: { name: true, phone: true } }, vendor: { select: { name: true, phone: true } }, logs: { orderBy: { createdAt: 'asc' } } },
    orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }], take: 300,
  }));
}

export async function createRepair(req: AuthRequest, res: Response) {
  const b = parse(z.object({
    unitId: z.string().nullable().optional(), area: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
    location: z.string().trim().max(100).default(''), category: z.string().trim().max(20).default('其他'),
    title: z.string().trim().min(1, '請填寫報修項目').max(100), description: z.string().trim().max(2000).default(''),
    priority: z.enum(['URGENT', 'HIGH', 'NORMAL', 'LOW']).default('NORMAL'),
  }), req.body);
  const r = await prisma.repair.create({ data: { ...b, unitId: b.unitId || null, communityId: req.cid!, repairNo: await nextDocNo('R') } });
  await prisma.repairLog.create({ data: { repairId: r.id, byName: req.user!.name, text: '管理中心登記報修' } });
  if (b.priority === 'URGENT') await notifyStaff(req.cid!, `【${req.community!.name}】急件報修 ${r.repairNo}\n${b.location} ${b.title}`);
  res.status(201).json(r);
}

const REPAIR_STATUS: Record<string, string> = { NEW: '待處理', ASSIGNED: '已派工', WORKING: '處理中', DONE: '已完工', CLOSED: '已結案', REJECTED: '不受理' };

/** 更新報修：狀態、派工廠商、費用；可附一段處理紀錄（預設住戶看得到），狀態變更會 LINE 通知報修住戶 */
export async function updateRepair(req: AuthRequest, res: Response) {
  const b = parse(z.object({
    status: z.enum(['NEW', 'ASSIGNED', 'WORKING', 'DONE', 'CLOSED', 'REJECTED']).optional(),
    vendorId: z.string().nullable().optional(), assignee: z.string().trim().max(50).optional(),
    cost: z.coerce.number().int().min(0).optional(), priority: z.enum(['URGENT', 'HIGH', 'NORMAL', 'LOW']).optional(),
    unitId: z.string().nullable().optional(), area: z.enum(['PUBLIC', 'PRIVATE']).optional(),
    location: z.string().trim().max(100).optional(), category: z.string().trim().max(20).optional(),
    title: z.string().trim().min(1, '請填寫報修項目').max(100).optional(), description: z.string().trim().max(2000).optional(),
    log: z.string().trim().max(1000).optional(), logPublic: z.boolean().default(true),
  }), req.body);
  const r = await prisma.repair.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!r) throw new HttpError(404, '找不到報修單');
  const { log, logPublic, ...rest } = b;
  const done = b.status === 'DONE' && r.status !== 'DONE';
  if (b.unitId && !(await prisma.unit.findFirst({ where: { id: b.unitId, communityId: req.cid! } }))) throw new HttpError(404, '找不到戶別');
  await prisma.repair.update({ where: { id: r.id }, data: {
    ...rest, vendorId: b.vendorId === undefined ? undefined : b.vendorId || null,
    unitId: b.unitId === undefined ? undefined : b.unitId || null, ...(done ? { doneAt: new Date() } : {}),
  } });
  const texts = [];
  if (b.status && b.status !== r.status) texts.push(`狀態：${REPAIR_STATUS[b.status]}`);
  if (log) texts.push(log);
  if (texts.length) await prisma.repairLog.create({ data: { repairId: r.id, byName: req.user!.name, public: logPublic, text: texts.join('；') } });
  if (r.unitId && b.status && b.status !== r.status && logPublic) {
    await notifyUnit(r.unitId, `【${req.community!.name}】您的報修「${r.title}」（${r.repairNo}）${REPAIR_STATUS[b.status]}${log ? `\n${log}` : ''}`);
  }
  res.json({ ok: true });
}

export async function deleteRepair(req: AuthRequest, res: Response) {
  const r = await prisma.repair.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!r) throw new HttpError(404, '找不到報修單');
  if (r.cost > 0 && req.user!.role !== 'ADMIN') throw new HttpError(403, '有費用紀錄的報修單只有物業公司管理員能刪除');
  await prisma.repair.delete({ where: { id: r.id } });
  await audit(req.cid, actor(req), '刪除報修', `${r.repairNo} ${r.title}`);
  res.json({ ok: true });
}

// ── 公告 ─────────────────────────────────────────────────────────────

export async function listAnnouncements(req: AuthRequest, res: Response) {
  const list = await prisma.announcement.findMany({
    where: { communityId: req.cid! }, orderBy: [{ pinned: 'desc' }, { publishDate: 'desc' }], take: 200,
    include: { _count: { select: { reads: true } } },
  });
  const residents = await prisma.resident.count({ where: { communityId: req.cid!, active: true, password: { not: '' } } });
  res.json({ list, residents });
}

export async function saveAnnouncement(req: AuthRequest, res: Response) {
  const id = req.params.id;
  const b = parse(z.object({
    title: z.string().trim().min(1, '請填寫標題').max(100), body: z.string().trim().max(10000).default(''),
    category: z.string().trim().max(20).default('一般'), pinned: z.boolean().default(false),
    publishDate: zDate.default(todayStr()), expireDate: z.union([zDate, z.literal('')]).default(''),
    push: z.boolean().default(false),
  }), req.body);
  const { push, ...rest } = b;
  const data = { ...rest, publishDate: toDate(b.publishDate), expireDate: b.expireDate ? toDate(b.expireDate) : null };
  let a;
  if (id) {
    if (!(await prisma.announcement.findFirst({ where: { id, communityId: req.cid! } }))) throw new HttpError(404, '找不到公告');
    a = await prisma.announcement.update({ where: { id }, data });
  } else a = await prisma.announcement.create({ data: { ...data, communityId: req.cid!, createdBy: req.user!.name } });
  let pushed = 0;
  if (push && b.publishDate <= todayStr()) {
    pushed = await notifyCommunity(req.cid!, `【${req.community!.name}公告】${b.title}\n\n${b.body.slice(0, 600)}${b.body.length > 600 ? '…（完整內容請見住戶專區）' : ''}`);
    await prisma.announcement.update({ where: { id: a.id }, data: { pushed: true } });
  }
  await audit(req.cid, actor(req), id ? '修改公告' : '發布公告', b.title);
  res.status(id ? 200 : 201).json({ id: a.id, pushed });
}

export async function deleteAnnouncement(req: AuthRequest, res: Response) {
  const a = await prisma.announcement.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!a) throw new HttpError(404, '找不到公告');
  await prisma.announcement.delete({ where: { id: a.id } });
  res.json({ ok: true });
}

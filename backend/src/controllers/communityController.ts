import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../prisma';
import { AuthRequest, communityIdsOf } from '../middleware/auth';
import { audit } from '../services/common';
import { arrears, fundBalances, HttpError } from '../services/feeService';
import { addDays, toDate, todayStr } from '../utils/dates';
import { parse } from '../utils/validate';

const communitySchema = z.object({
  name: z.string().trim().min(1, '請填寫社區名稱').max(80),
  address: z.string().trim().max(200).default(''),
  phone: z.string().trim().max(30).default(''),
  feeMode: z.enum(['AREA', 'FIXED']).default('AREA'),
  feeRate: z.coerce.number().min(0, '管理費單價不可為負數').default(0),
  reserveRatio: z.coerce.number().min(0).max(100, '公共基金提撥比例須在 0～100% 之間').default(0),
  dueDay: z.coerce.number().int().min(1).max(31, '繳費期限日須在 1～31 之間').default(15),
  autoBillDay: z.coerce.number().int().min(0).max(28, '自動開帳日須在 0～28 之間（0＝不自動）').default(1),
  remindDaysBefore: z.coerce.number().int().min(0).max(30).default(3),
  bankInfo: z.string().trim().max(200).default(''),
  openingMgmt: z.coerce.number().int().default(0),
  openingReserve: z.coerce.number().int().default(0),
  openingDate: z.string().trim().max(10).default(''),
  quorumAttend: z.coerce.number().min(0).max(1).default(0.6667),
  quorumPass: z.coerce.number().min(0).max(1).default(0.75),
  quorumReAttend: z.coerce.number().min(0).max(1).default(0.2),
  quorumRePass: z.coerce.number().min(0).max(1).default(0.5),
  packageOverdueDays: z.coerce.number().int().min(1).max(60).default(7),
  note: z.string().trim().max(1000).default(''),
});

export async function listCommunities(req: AuthRequest, res: Response) {
  const ids = await communityIdsOf(req.user!);
  const list = await prisma.community.findMany({ where: { id: { in: ids } }, orderBy: { name: 'asc' } });
  res.json(list);
}

export async function getCommunity(req: AuthRequest, res: Response) {
  res.json(req.community);
}

export async function createCommunity(req: AuthRequest, res: Response) {
  const data = parse(communitySchema, req.body);
  const c = await prisma.community.create({ data });
  // 預設的法定檢查項目：建好社區就提醒要排
  const t = todayStr();
  await prisma.inspection.createMany({
    data: DEFAULT_INSPECTIONS.map((i) => ({ communityId: c.id, kind: i.kind, title: i.title, cycleMonths: i.cycle, dueDate: toDate(addDays(t, 30)), note: i.note })),
  });
  await audit(c.id, { type: 'staff', id: req.user!.id, name: req.user!.name }, '新增社區', c.name);
  res.status(201).json(c);
}

export async function updateCommunity(req: AuthRequest, res: Response) {
  const data = parse(communitySchema.partial(), req.body);
  const c = await prisma.community.update({ where: { id: req.cid! }, data });
  await audit(c.id, { type: 'staff', id: req.user!.id, name: req.user!.name }, '修改社區設定');
  res.json(c);
}

/** 法定檢查與申報的預設清單（實際週期依建物用途、規模與主管機關公告，建立後可調整） */
export const DEFAULT_INSPECTIONS = [
  { kind: '消防', title: '消防安全設備檢修申報', cycle: 12, note: '消防法第 9 條：依場所類別每年或每半年委託消防設備師（士）檢修並向消防機關申報' },
  { kind: '建管', title: '建築物公共安全檢查簽證及申報', cycle: 24, note: '建築法第 77 條：依建築物用途類組與規模定期申報（住宅類多為 2～4 年）' },
  { kind: '電梯', title: '升降設備安全檢查（使用許可證）', cycle: 12, note: '建築物昇降設備設置及檢查管理辦法：每年安全檢查，取得使用許可證並張貼於機廂內' },
  { kind: '電梯', title: '電梯每月定期保養', cycle: 1, note: '須由登記之專業廠商每月保養一次' },
  { kind: '機械停車', title: '機械停車設備安全檢查', cycle: 12, note: '有機械式停車設備者適用' },
  { kind: '給水', title: '水塔（蓄水池）清洗', cycle: 6, note: '飲用水設備維護管理辦法：至少每六個月清洗一次並留存紀錄' },
  { kind: '環境', title: '化糞池清理', cycle: 12, note: '依建築物污水處理設施規定定期清理' },
];

/** 物業公司總覽：每個社區的關鍵數字 */
export async function overview(req: AuthRequest, res: Response) {
  const ids = await communityIdsOf(req.user!);
  const t = todayStr();
  const period = t.slice(0, 7);
  const communities = await prisma.community.findMany({ where: { id: { in: ids } }, orderBy: { name: 'asc' } });
  const rows = await Promise.all(communities.map(async (c) => {
    const [units, bills, pkgs, repairs, insp, pending] = await Promise.all([
      prisma.unit.count({ where: { communityId: c.id, active: true } }),
      prisma.feeBill.aggregate({ where: { communityId: c.id, period, status: { not: 'VOID' } }, _sum: { total: true, paid: true } }),
      prisma.package.count({ where: { communityId: c.id, status: 'WAITING' } }),
      prisma.repair.count({ where: { communityId: c.id, status: { in: ['NEW', 'ASSIGNED', 'WORKING'] } } }),
      prisma.inspection.count({ where: { communityId: c.id, status: 'PENDING', dueDate: { lte: toDate(addDays(t, 30)) } } }),
      prisma.ledgerEntry.count({ where: { communityId: c.id, approval: 'PENDING' } }),
    ]);
    const arr = await arrears(c.id, t);
    const bal = await fundBalances(c);
    const billed = bills._sum.total ?? 0, paid = bills._sum.paid ?? 0;
    return {
      id: c.id, name: c.name, units, billed, paid, rate: billed ? Math.round(paid / billed * 1000) / 10 : null,
      arrearsUnits: arr.length, arrearsAmount: arr.reduce((s, a) => s + a.amount, 0), overTwo: arr.filter((a) => a.overTwo).length,
      packages: pkgs, openRepairs: repairs, inspectionsDue: insp, pendingApprovals: pending, balance: bal,
    };
  }));
  res.json({ period, communities: rows });
}

/** 單一社區今日工作台 */
export async function dashboard(req: AuthRequest, res: Response) {
  const cid = req.cid!, c = req.community!;
  const t = todayStr(), period = t.slice(0, 7);
  const [units, residents, bills, waitingPkgs, oldPkgs, repairs, todayBookings, inspections, contracts, pending] = await Promise.all([
    prisma.unit.count({ where: { communityId: cid, active: true } }),
    prisma.resident.count({ where: { communityId: cid, active: true } }),
    prisma.feeBill.aggregate({ where: { communityId: cid, period, status: { not: 'VOID' } }, _sum: { total: true, paid: true }, _count: true }),
    prisma.package.count({ where: { communityId: cid, status: 'WAITING' } }),
    prisma.package.count({ where: { communityId: cid, status: 'WAITING', receivedAt: { lt: new Date(Date.now() - c.packageOverdueDays * 86400000) } } }),
    prisma.repair.findMany({ where: { communityId: cid, status: { in: ['NEW', 'ASSIGNED', 'WORKING'] } }, include: { unit: { select: { label: true } } }, orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }], take: 8 }),
    prisma.booking.findMany({ where: { communityId: cid, date: toDate(t), status: 'BOOKED' }, include: { facility: { select: { name: true } }, unit: { select: { label: true } } }, orderBy: { startTime: 'asc' } }),
    prisma.inspection.findMany({ where: { communityId: cid, status: 'PENDING', dueDate: { lte: toDate(addDays(t, 60)) } }, orderBy: { dueDate: 'asc' } }),
    prisma.contract.findMany({ where: { communityId: cid, active: true, endDate: { not: null } }, include: { vendor: { select: { name: true } } } }),
    prisma.ledgerEntry.count({ where: { communityId: cid, approval: 'PENDING' } }),
  ]);
  const arr = await arrears(cid, t);
  const billed = bills._sum.total ?? 0, paid = bills._sum.paid ?? 0;
  res.json({
    community: c, period, units, residents,
    collection: { billed, paid, bills: bills._count, rate: billed ? Math.round(paid / billed * 1000) / 10 : null },
    arrears: { units: arr.length, amount: arr.reduce((s, a) => s + a.amount, 0), overTwo: arr.filter((a) => a.overTwo).length },
    packages: { waiting: waitingPkgs, overdue: oldPkgs },
    repairs, todayBookings, inspections,
    contracts: contracts.filter((k) => k.endDate! <= toDate(addDays(t, k.notifyDays))),
    pendingApprovals: pending,
    balance: await fundBalances(c),
  });
}

// ── 帳號管理（物業公司管理員）────────────────────────────────────────

const userSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_.-]{3,30}$/, '帳號須為 3～30 碼英數字'),
  name: z.string().trim().min(1, '請填寫姓名').max(50),
  role: z.enum(['ADMIN', 'MANAGER', 'COMMITTEE']),
  title: z.string().trim().max(30).default(''),
  phone: z.string().trim().max(30).default(''),
  password: z.string().min(8, '密碼至少 8 碼').optional(),
  active: z.boolean().default(true),
  communityIds: z.array(z.string()).default([]),
});

export async function listUsers(_req: AuthRequest, res: Response) {
  const users = await prisma.user.findMany({
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
    select: { id: true, username: true, name: true, role: true, title: true, phone: true, active: true, lineUserId: true, communities: { select: { communityId: true } } },
  });
  res.json(users.map(({ lineUserId, communities, ...u }) => ({ ...u, lineBound: Boolean(lineUserId), communityIds: communities.map((c) => c.communityId) })));
}

export async function saveUser(req: AuthRequest, res: Response) {
  const id = req.params.id;
  const b = parse(id ? userSchema.partial({ password: true }) : userSchema.required({ password: true }), req.body);
  if (id === req.user!.id && (b.role !== 'ADMIN' || b.active === false)) throw new HttpError(400, '不能停用自己或拿掉自己的管理員權限');
  const { communityIds, password, ...rest } = b;
  const data = { ...rest, ...(password ? { password: await bcrypt.hash(password, 10) } : {}) };
  const user = id
    ? await prisma.user.update({ where: { id }, data })
    : await prisma.user.create({ data: { ...data, password: data.password! } });
  await prisma.userCommunity.deleteMany({ where: { userId: user.id } });
  if (user.role !== 'ADMIN' && communityIds.length) {
    await prisma.userCommunity.createMany({ data: communityIds.map((communityId) => ({ userId: user.id, communityId })), skipDuplicates: true });
  }
  await audit(null, { type: 'staff', id: req.user!.id, name: req.user!.name }, id ? '修改帳號' : '新增帳號', `${user.username}（${user.role}）`);
  res.status(id ? 200 : 201).json({ id: user.id });
}

export async function auditLogs(req: AuthRequest, res: Response) {
  const logs = await prisma.auditLog.findMany({ where: { communityId: req.cid! }, orderBy: { createdAt: 'desc' }, take: 300 });
  res.json(logs);
}

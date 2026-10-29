import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/auth';
import { audit } from '../services/common';
import { HttpError, mgmtFeeOf } from '../services/feeService';
import { parse } from '../utils/validate';
import { byLabel } from '../utils/dates';
import { assignVaCodes } from './communityController';

const actor = (req: AuthRequest) => ({ type: 'staff' as const, id: req.user!.id, name: req.user!.name });

const unitSchema = z.object({
  building: z.string().trim().max(20).default(''),
  floor: z.string().trim().max(10).default(''),
  no: z.string().trim().max(20).default(''),
  label: z.string().trim().min(1, '請填寫戶別').max(40),
  area: z.coerce.number().min(0, '坪數不可為負數').default(0),
  share: z.coerce.number().min(0, '區分所有權比例不可為負數').default(0),
  feeOverride: z.union([z.coerce.number().int().min(0), z.null()]).optional(),
  occupancy: z.enum(['SELF', 'RENT', 'VACANT', 'SHOP']).default('SELF'),
  ownerName: z.string().trim().max(50).default(''),
  note: z.string().trim().max(500).default(''),
});

export async function listUnits(req: AuthRequest, res: Response) {
  const c = req.community!;
  const units = await prisma.unit.findMany({
    where: { communityId: req.cid!, active: true },
    include: {
      residents: { where: { active: true }, orderBy: { relation: 'asc' }, select: { id: true, name: true, phone: true, email: true, relation: true, lineUserId: true, lastLogin: true, note: true } },
      parkingSpaces: true,
    },
    orderBy: [{ building: 'asc' }, { label: 'asc' }],
  });
  const owed = await prisma.feeBill.groupBy({ by: ['unitId'], where: { communityId: req.cid!, status: { in: ['UNPAID', 'PARTIAL'] } }, _sum: { total: true, paid: true }, _count: true });
  const owedMap = new Map(owed.map((o) => [o.unitId, { amount: (o._sum.total ?? 0) - (o._sum.paid ?? 0), count: o._count }]));
  res.json(units.sort(byLabel).map((u) => ({
    ...u,
    residents: u.residents.map(({ lineUserId, ...r }) => ({ ...r, lineBound: Boolean(lineUserId) })),
    monthlyFee: mgmtFeeOf(c, u) + u.parkingSpaces.reduce((s, p) => s + p.monthlyFee, 0),
    owed: owedMap.get(u.id) ?? { amount: 0, count: 0 },
  })));
}

export async function saveUnit(req: AuthRequest, res: Response) {
  const id = req.params.id;
  const data = parse(unitSchema, req.body);
  if (id) {
    const u = await prisma.unit.findFirst({ where: { id, communityId: req.cid! } });
    if (!u) throw new HttpError(404, '找不到戶別');
    await prisma.unit.update({ where: { id }, data });
  } else {
    await prisma.unit.create({ data: { ...data, communityId: req.cid! } });
  }
  if (!id && req.community!.vaPrefix) await assignVaCodes(req.cid!, req.community!.vaPrefix);
  await audit(req.cid, actor(req), id ? '修改戶別' : '新增戶別', data.label);
  res.status(id ? 200 : 201).json({ ok: true });
}

/** 戶別停用（保留歷史帳務，不實際刪除） */
export async function deleteUnit(req: AuthRequest, res: Response) {
  const u = await prisma.unit.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!u) throw new HttpError(404, '找不到戶別');
  const owed = await prisma.feeBill.count({ where: { unitId: u.id, status: { in: ['UNPAID', 'PARTIAL'] } } });
  if (owed) throw new HttpError(400, `這一戶還有 ${owed} 期未繳清，請先處理帳務再停用`);
  await prisma.unit.update({ where: { id: u.id }, data: { active: false, label: `${u.label}（停用 ${u.id.slice(-4)}）` } });
  await prisma.resident.updateMany({ where: { unitId: u.id }, data: { active: false } });
  await audit(req.cid, actor(req), '停用戶別', u.label);
  res.json({ ok: true });
}

/**
 * 批次匯入戶別：每行一戶，欄位以逗號或 Tab 分隔：
 * 戶別, 棟, 樓, 號, 坪數, 區分所有權比例, 所有權人
 * 已存在的戶別（同名）會更新坪數等資料。
 */
export async function importUnits(req: AuthRequest, res: Response) {
  const { text } = parse(z.object({ text: z.string().max(200000) }), req.body);
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('戶別'));
  let created = 0, updated = 0;
  const errors: string[] = [];
  for (const [i, line] of rows.entries()) {
    const [label, building = '', floor = '', no = '', area = '0', share = '0', ownerName = ''] = line.split(/\t|,/).map((s) => s.trim());
    const a = Number(area), s = Number(share);
    if (!label || Number.isNaN(a) || Number.isNaN(s)) { errors.push(`第 ${i + 1} 行格式不正確：${line}`); continue; }
    const data = { building, floor, no, area: a, share: s, ownerName };
    const exist = await prisma.unit.findUnique({ where: { communityId_label: { communityId: req.cid!, label } } });
    if (exist) { await prisma.unit.update({ where: { id: exist.id }, data: { ...data, active: true } }); updated++; }
    else { await prisma.unit.create({ data: { ...data, label, communityId: req.cid! } }); created++; }
  }
  await audit(req.cid, actor(req), '批次匯入戶別', `新增 ${created}、更新 ${updated}`);
  if (created && req.community!.vaPrefix) await assignVaCodes(req.cid!, req.community!.vaPrefix);
  res.json({ created, updated, errors });
}

// ── 住戶 ─────────────────────────────────────────────────────────────

const residentSchema = z.object({
  unitId: z.string().min(1, '請選擇戶別'),
  name: z.string().trim().min(1, '請填寫姓名').max(50),
  phone: z.string().trim().regex(/^(09\d{8})?$/, '手機號碼格式應為 09 開頭 10 碼').default(''),
  email: z.string().trim().max(100).default(''),
  relation: z.enum(['OWNER', 'TENANT', 'FAMILY']).default('OWNER'),
  note: z.string().trim().max(500).default(''),
});

/** 住戶初始密碼＝手機末 6 碼，第一次登入必須改密碼 */
export async function saveResident(req: AuthRequest, res: Response) {
  const id = req.params.id;
  const b = parse(residentSchema, req.body);
  const unit = await prisma.unit.findFirst({ where: { id: b.unitId, communityId: req.cid!, active: true } });
  if (!unit) throw new HttpError(404, '找不到戶別');
  if (b.phone) {
    const dup = await prisma.resident.findFirst({ where: { communityId: req.cid!, phone: b.phone, active: true, ...(id ? { id: { not: id } } : {}) } });
    if (dup) throw new HttpError(409, `這支手機已是本社區住戶「${dup.name}」的登入帳號`);
  }
  if (id) {
    const r = await prisma.resident.findFirst({ where: { id, communityId: req.cid! } });
    if (!r) throw new HttpError(404, '找不到住戶');
    await prisma.resident.update({ where: { id }, data: b });
  } else {
    await prisma.resident.create({
      data: { ...b, communityId: req.cid!, password: b.phone ? await bcrypt.hash(b.phone.slice(-6), 10) : '' },
    });
  }
  await audit(req.cid, actor(req), id ? '修改住戶' : '新增住戶', `${unit.label} ${b.name}`);
  res.status(id ? 200 : 201).json({ ok: true });
}

export async function deleteResident(req: AuthRequest, res: Response) {
  const r = await prisma.resident.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!r) throw new HttpError(404, '找不到住戶');
  await prisma.resident.update({ where: { id: r.id }, data: { active: false, lineUserId: null } });
  await audit(req.cid, actor(req), '移除住戶', r.name);
  res.json({ ok: true });
}

export async function resetResidentPassword(req: AuthRequest, res: Response) {
  const r = await prisma.resident.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!r) throw new HttpError(404, '找不到住戶');
  if (!r.phone) throw new HttpError(400, '這位住戶沒有手機號碼，無法開通登入');
  await prisma.resident.update({ where: { id: r.id }, data: { password: await bcrypt.hash(r.phone.slice(-6), 10), mustChangePassword: true } });
  await audit(req.cid, actor(req), '重設住戶密碼', r.name);
  res.json({ ok: true, hint: '密碼已重設為手機末 6 碼' });
}

// ── 車位 ─────────────────────────────────────────────────────────────

const parkingSchema = z.object({
  code: z.string().trim().min(1, '請填寫車位編號').max(20),
  kind: z.enum(['CAR', 'MOTO']).default('CAR'),
  unitId: z.string().nullable().optional(),
  monthlyFee: z.coerce.number().int().min(0).default(0),
  note: z.string().trim().max(200).default(''),
});

export async function listParking(req: AuthRequest, res: Response) {
  res.json(await prisma.parkingSpace.findMany({ where: { communityId: req.cid! }, include: { unit: { select: { label: true } } }, orderBy: { code: 'asc' } }));
}

export async function saveParking(req: AuthRequest, res: Response) {
  const id = req.params.id;
  const b = parse(parkingSchema, req.body);
  if (b.unitId && !(await prisma.unit.findFirst({ where: { id: b.unitId, communityId: req.cid! } }))) throw new HttpError(404, '找不到戶別');
  const data = { ...b, unitId: b.unitId || null };
  if (id) {
    if (!(await prisma.parkingSpace.findFirst({ where: { id, communityId: req.cid! } }))) throw new HttpError(404, '找不到車位');
    await prisma.parkingSpace.update({ where: { id }, data });
  } else {
    await prisma.parkingSpace.create({ data: { ...data, communityId: req.cid! } });
  }
  res.status(id ? 200 : 201).json({ ok: true });
}

export async function deleteParking(req: AuthRequest, res: Response) {
  const p = await prisma.parkingSpace.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!p) throw new HttpError(404, '找不到車位');
  await prisma.parkingSpace.delete({ where: { id: p.id } });
  res.json({ ok: true });
}

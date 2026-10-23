import { Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/auth';
import { audit } from '../services/common';
import { HttpError } from '../services/feeService';
import { addMonths, dateStr, toDate, todayStr } from '../utils/dates';
import { parse, zDate } from '../utils/validate';

const actor = (req: AuthRequest) => ({ type: 'staff' as const, id: req.user!.id, name: req.user!.name });

export const VENDOR_KINDS = ['清潔', '保全', '電梯', '消防', '機電', '水電', '園藝', '機械停車', '病媒防治', '其他'];

export async function listVendors(req: AuthRequest, res: Response) {
  res.json(await prisma.vendor.findMany({ where: { communityId: req.cid!, active: true }, orderBy: [{ kind: 'asc' }, { name: 'asc' }] }));
}

export async function saveVendor(req: AuthRequest, res: Response) {
  const id = req.params.id;
  const b = parse(z.object({
    name: z.string().trim().min(1, '請填寫廠商名稱').max(60), kind: z.string().trim().max(20).default('其他'),
    contact: z.string().trim().max(30).default(''), phone: z.string().trim().max(30).default(''),
    taxId: z.string().trim().regex(/^(\d{8})?$/, '統一編號應為 8 位數字').default(''), note: z.string().trim().max(500).default(''),
  }), req.body);
  if (id) {
    if (!(await prisma.vendor.findFirst({ where: { id, communityId: req.cid! } }))) throw new HttpError(404, '找不到廠商');
    await prisma.vendor.update({ where: { id }, data: b });
  } else await prisma.vendor.create({ data: { ...b, communityId: req.cid! } });
  res.status(id ? 200 : 201).json({ ok: true });
}

export async function deleteVendor(req: AuthRequest, res: Response) {
  const v = await prisma.vendor.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!v) throw new HttpError(404, '找不到廠商');
  await prisma.vendor.update({ where: { id: v.id }, data: { active: false } });
  res.json({ ok: true });
}

// ── 合約 ─────────────────────────────────────────────────────────────

export async function listContracts(req: AuthRequest, res: Response) {
  const list = await prisma.contract.findMany({ where: { communityId: req.cid!, active: true }, include: { vendor: { select: { name: true } } }, orderBy: { endDate: 'asc' } });
  const t = todayStr();
  res.json(list.map((k) => ({ ...k, daysLeft: k.endDate ? Math.round((k.endDate.getTime() - toDate(t).getTime()) / 86400000) : null })));
}

export async function saveContract(req: AuthRequest, res: Response) {
  const id = req.params.id;
  const b = parse(z.object({
    vendorId: z.string().nullable().optional(), title: z.string().trim().min(1, '請填寫合約名稱').max(80),
    kind: z.string().trim().max(20).default('其他'), monthlyAmount: z.coerce.number().int().min(0).default(0),
    startDate: z.union([zDate, z.literal('')]).default(''), endDate: z.union([zDate, z.literal('')]).default(''),
    notifyDays: z.coerce.number().int().min(0).max(365).default(60), note: z.string().trim().max(1000).default(''),
  }), req.body);
  const data = { ...b, vendorId: b.vendorId || null, startDate: b.startDate ? toDate(b.startDate) : null, endDate: b.endDate ? toDate(b.endDate) : null };
  if (id) {
    if (!(await prisma.contract.findFirst({ where: { id, communityId: req.cid! } }))) throw new HttpError(404, '找不到合約');
    await prisma.contract.update({ where: { id }, data });
  } else await prisma.contract.create({ data: { ...data, communityId: req.cid! } });
  await audit(req.cid, actor(req), id ? '修改合約' : '新增合約', b.title);
  res.status(id ? 200 : 201).json({ ok: true });
}

export async function deleteContract(req: AuthRequest, res: Response) {
  const k = await prisma.contract.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!k) throw new HttpError(404, '找不到合約');
  await prisma.contract.update({ where: { id: k.id }, data: { active: false } });
  res.json({ ok: true });
}

// ── 法定檢查與例行保養 ───────────────────────────────────────────────

export async function listInspections(req: AuthRequest, res: Response) {
  const list = await prisma.inspection.findMany({ where: { communityId: req.cid! }, include: { vendor: { select: { name: true } } }, orderBy: [{ status: 'asc' }, { dueDate: 'asc' }], take: 300 });
  res.json(list);
}

export async function saveInspection(req: AuthRequest, res: Response) {
  const id = req.params.id;
  const b = parse(z.object({
    kind: z.string().trim().max(20).default('其他'), title: z.string().trim().min(1, '請填寫項目名稱').max(80),
    dueDate: zDate, cycleMonths: z.coerce.number().int().min(0).max(120).default(12),
    vendorId: z.string().nullable().optional(), note: z.string().trim().max(1000).default(''),
  }), req.body);
  const data = { ...b, vendorId: b.vendorId || null, dueDate: toDate(b.dueDate) };
  if (id) {
    if (!(await prisma.inspection.findFirst({ where: { id, communityId: req.cid! } }))) throw new HttpError(404, '找不到項目');
    await prisma.inspection.update({ where: { id }, data });
  } else await prisma.inspection.create({ data: { ...data, communityId: req.cid! } });
  res.status(id ? 200 : 201).json({ ok: true });
}

/** 完成一次檢查／申報：登錄結果，並依週期自動排出下一次 */
export async function completeInspection(req: AuthRequest, res: Response) {
  const b = parse(z.object({ doneDate: zDate.default(todayStr()), result: z.string().trim().max(1000).default(''), skip: z.boolean().default(false) }), req.body);
  const i = await prisma.inspection.findFirst({ where: { id: req.params.id, communityId: req.cid!, status: 'PENDING' } });
  if (!i) throw new HttpError(404, '找不到待辦項目');
  await prisma.inspection.update({ where: { id: i.id }, data: { status: b.skip ? 'SKIPPED' : 'DONE', doneDate: toDate(b.doneDate), result: b.result } });
  let next = null;
  if (i.cycleMonths > 0) {
    next = await prisma.inspection.create({
      data: { communityId: i.communityId, kind: i.kind, title: i.title, cycleMonths: i.cycleMonths, vendorId: i.vendorId, note: i.note, dueDate: toDate(addMonths(dateStr(i.dueDate), i.cycleMonths)) },
    });
  }
  await audit(req.cid, actor(req), b.skip ? '略過檢查' : '完成檢查申報', `${i.title} ${b.doneDate}`);
  res.json({ ok: true, next: next ? dateStr(next.dueDate) : null });
}

export async function deleteInspection(req: AuthRequest, res: Response) {
  const i = await prisma.inspection.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!i) throw new HttpError(404, '找不到項目');
  await prisma.inspection.delete({ where: { id: i.id } });
  res.json({ ok: true });
}

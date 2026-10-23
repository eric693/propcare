import { Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/auth';
import { audit } from '../services/common';
import { arrears, fundBalances, generateBills, HttpError, monthlyReport, recordPayment, voidPayment } from '../services/feeService';
import { notifyUnit } from '../services/lineService';
import { byLabel, dateStr, toDate, todayStr } from '../utils/dates';
import { parse, zDate, zPeriod } from '../utils/validate';

const actor = (req: AuthRequest) => ({ type: 'staff' as const, id: req.user!.id, name: req.user!.name });

// ── 帳單 ─────────────────────────────────────────────────────────────

export async function listBills(req: AuthRequest, res: Response) {
  const period = String(req.query.period ?? todayStr().slice(0, 7));
  const status = String(req.query.status ?? '');
  const where: Prisma.FeeBillWhereInput = { communityId: req.cid!, period, ...(status ? { status: status as never } : {}) };
  const bills = await prisma.feeBill.findMany({
    where, include: { unit: { select: { label: true, ownerName: true, building: true } }, payments: { where: { voided: false }, select: { receiptNo: true, paidDate: true, amount: true, method: true } } },
  });
  res.json(bills.sort((a, b) => byLabel(a.unit, b.unit)));
}

export async function createBills(req: AuthRequest, res: Response) {
  const b = parse(z.object({
    period: zPeriod,
    unitIds: z.array(z.string()).optional(),
    otherAmount: z.coerce.number().int().min(0).default(0),
    otherNote: z.string().trim().max(100).default(''),
    notify: z.boolean().default(false),
  }), req.body);
  const r = await generateBills(req.cid!, b.period, b.unitIds, b.otherAmount ? { amount: b.otherAmount, note: b.otherNote } : undefined);
  let notified = 0;
  if (b.notify && r.created) {
    const c = req.community!;
    const bills = await prisma.feeBill.findMany({ where: { communityId: req.cid!, period: b.period, ...(b.unitIds ? { unitId: { in: b.unitIds } } : {}) } });
    for (const bill of bills) notified += await notifyUnit(bill.unitId, `【${c.name}】${b.period} 管理費帳單已開立\n應繳 ${bill.total.toLocaleString()} 元，繳費期限 ${dateStr(bill.dueDate)}${c.bankInfo ? `\n繳費帳戶：${c.bankInfo}` : ''}`);
  }
  await audit(req.cid, actor(req), '開立帳單', `${b.period} ${r.created} 張`);
  res.status(201).json({ ...r, notified });
}

/** 調整帳單：其他費用（如裝潢清潔費）或作廢；已有收款的帳單不能作廢 */
export async function updateBill(req: AuthRequest, res: Response) {
  const b = parse(z.object({
    amountOther: z.coerce.number().int().min(0).optional(),
    otherNote: z.string().trim().max(100).optional(),
    void: z.boolean().optional(),
  }), req.body);
  const bill = await prisma.feeBill.findFirst({ where: { id: req.params.id, communityId: req.cid! }, include: { unit: true } });
  if (!bill) throw new HttpError(404, '找不到帳單');
  if (b.void) {
    if (bill.paid > 0) throw new HttpError(400, '已有收款的帳單不能作廢，請先作廢收款');
    await prisma.feeBill.update({ where: { id: bill.id }, data: { status: 'VOID' } });
    await audit(req.cid, actor(req), '作廢帳單', `${bill.unit.label} ${bill.period}`);
    res.json({ ok: true }); return;
  }
  const amountOther = b.amountOther ?? bill.amountOther;
  const total = bill.amountMgmt + bill.amountParking + amountOther;
  if (total < bill.paid) throw new HttpError(400, `調整後金額不能低於已收的 ${bill.paid.toLocaleString()} 元`);
  const status = bill.status === 'VOID' ? 'VOID' : bill.paid === 0 ? 'UNPAID' : bill.paid >= total ? 'PAID' : 'PARTIAL';
  await prisma.feeBill.update({ where: { id: bill.id }, data: { amountOther, otherNote: b.otherNote ?? bill.otherNote, total, status } });
  await audit(req.cid, actor(req), '調整帳單', `${bill.unit.label} ${bill.period} 其他費用 ${amountOther}`);
  res.json({ ok: true });
}

export async function pay(req: AuthRequest, res: Response) {
  const b = parse(z.object({
    billId: z.string(),
    amount: z.coerce.number().int().positive('收款金額必須大於 0'),
    method: z.enum(['CASH', 'TRANSFER', 'ATM', 'STORE', 'OTHER']).default('CASH'),
    paidDate: zDate.default(todayStr()),
    note: z.string().trim().max(200).default(''),
  }), req.body);
  const r = await recordPayment({ communityId: req.cid!, ...b, by: req.user!.name });
  res.status(201).json(r);
}

/** 一戶多期一次繳清：從最舊的未繳期別開始沖 */
export async function payUnit(req: AuthRequest, res: Response) {
  const b = parse(z.object({
    unitId: z.string(),
    amount: z.coerce.number().int().positive('收款金額必須大於 0'),
    method: z.enum(['CASH', 'TRANSFER', 'ATM', 'STORE', 'OTHER']).default('CASH'),
    paidDate: zDate.default(todayStr()),
    note: z.string().trim().max(200).default(''),
  }), req.body);
  const bills = await prisma.feeBill.findMany({ where: { communityId: req.cid!, unitId: b.unitId, status: { in: ['UNPAID', 'PARTIAL'] } }, orderBy: { period: 'asc' } });
  const owed = bills.reduce((s, x) => s + x.total - x.paid, 0);
  if (!bills.length) throw new HttpError(400, '這一戶沒有未繳帳單');
  if (b.amount > owed) throw new HttpError(400, `收款金額超過未繳總額 ${owed.toLocaleString()} 元`);
  let left = b.amount;
  const receipts: string[] = [];
  for (const bill of bills) {
    if (left <= 0) break;
    const amt = Math.min(left, bill.total - bill.paid);
    const r = await recordPayment({ communityId: req.cid!, billId: bill.id, amount: amt, method: b.method, paidDate: b.paidDate, note: b.note, by: req.user!.name });
    receipts.push(r.payment.receiptNo);
    left -= amt;
  }
  res.status(201).json({ receipts });
}

export async function listPayments(req: AuthRequest, res: Response) {
  const from = String(req.query.from ?? `${todayStr().slice(0, 7)}-01`), to = String(req.query.to ?? todayStr());
  res.json(await prisma.feePayment.findMany({
    where: { communityId: req.cid!, paidDate: { gte: toDate(from), lte: toDate(to) } },
    include: { unit: { select: { label: true } }, bill: { select: { period: true } } },
    orderBy: [{ paidDate: 'desc' }, { createdAt: 'desc' }],
  }));
}

export async function cancelPayment(req: AuthRequest, res: Response) {
  const { reason } = parse(z.object({ reason: z.string().trim().min(1, '請填寫作廢原因').max(200) }), req.body);
  await voidPayment(req.cid!, req.params.id, req.user!.name, reason);
  res.json({ ok: true });
}

export async function getArrears(req: AuthRequest, res: Response) {
  res.json(await arrears(req.cid!));
}

/** 一戶的帳務明細（對帳單） */
export async function unitStatement(req: AuthRequest, res: Response) {
  const unit = await prisma.unit.findFirst({ where: { id: req.params.unitId, communityId: req.cid! }, include: { residents: { where: { active: true } } } });
  if (!unit) throw new HttpError(404, '找不到戶別');
  const bills = await prisma.feeBill.findMany({ where: { unitId: unit.id }, include: { payments: true }, orderBy: { period: 'desc' }, take: 36 });
  res.json({ unit, bills });
}

// ── 收支帳 ───────────────────────────────────────────────────────────

export const EXPENSE_CATEGORIES = ['清潔費', '保全費', '水電費', '電梯保養', '消防保養', '機電維修', '修繕工程', '園藝綠化', '行政文具', '保險費', '物業管理費', '會議費用', '雜支'];
export const INCOME_CATEGORIES = ['管理費收入', '公共基金提撥', '車位清潔費', '公設使用費', '利息收入', '其他收入'];

export async function listLedger(req: AuthRequest, res: Response) {
  const month = String(req.query.month ?? todayStr().slice(0, 7));
  const [y, m] = month.split('-').map(Number);
  const fund = String(req.query.fund ?? '');
  const rows = await prisma.ledgerEntry.findMany({
    where: {
      communityId: req.cid!, ...(fund ? { fund: fund as never } : {}),
      date: { gte: toDate(`${month}-01`), lte: toDate(dateStr(new Date(Date.UTC(y, m, 0)))) },
    },
    include: { vendor: { select: { name: true } } },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
  res.json({ rows, balance: await fundBalances(req.community!), categories: { in: INCOME_CATEGORIES, out: EXPENSE_CATEGORIES } });
}

/** 人工記帳。支出一律先列「待核准」，由管委會委員或物業管理員核准後才計入餘額。 */
export async function createLedger(req: AuthRequest, res: Response) {
  const b = parse(z.object({
    date: zDate, fund: z.enum(['MGMT', 'RESERVE']).default('MGMT'), direction: z.enum(['IN', 'OUT']),
    category: z.string().trim().min(1, '請選擇科目').max(30), amount: z.coerce.number().int().positive('金額必須大於 0'),
    description: z.string().trim().max(300).default(''), vendorId: z.string().nullable().optional(), voucherNo: z.string().trim().max(30).default(''),
  }), req.body);
  if (b.category === '管理費收入' || b.category === '公共基金提撥') throw new HttpError(400, '管理費收入請在「管理費」頁登錄收款，系統會自動入帳');
  const e = await prisma.ledgerEntry.create({
    data: { ...b, vendorId: b.vendorId || null, date: toDate(b.date), communityId: req.cid!, createdBy: req.user!.name, approval: b.direction === 'OUT' ? 'PENDING' : 'APPROVED' },
  });
  await audit(req.cid, actor(req), b.direction === 'OUT' ? '登錄支出（待核准）' : '登錄收入', `${b.category} ${b.amount}`);
  res.status(201).json(e);
}

export async function approveLedger(req: AuthRequest, res: Response) {
  const { approve } = parse(z.object({ approve: z.boolean() }), req.body);
  if (req.user!.role === 'MANAGER') throw new HttpError(403, '支出須由管委會委員或物業公司管理員核准');
  const e = await prisma.ledgerEntry.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!e) throw new HttpError(404, '找不到這筆帳');
  if (e.approval !== 'PENDING') throw new HttpError(400, '這筆帳已處理過');
  await prisma.ledgerEntry.update({ where: { id: e.id }, data: { approval: approve ? 'APPROVED' : 'REJECTED', approvedBy: req.user!.name } });
  await audit(req.cid, actor(req), approve ? '核准支出' : '退回支出', `${e.category} ${e.amount}`);
  res.json({ ok: true });
}

export async function deleteLedger(req: AuthRequest, res: Response) {
  const e = await prisma.ledgerEntry.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!e) throw new HttpError(404, '找不到這筆帳');
  if (e.paymentId) throw new HttpError(400, '管理費收款自動產生的帳，請到收款紀錄作廢');
  if (e.approval === 'APPROVED' && e.direction === 'OUT' && req.user!.role !== 'ADMIN') throw new HttpError(403, '已核准的支出只有物業公司管理員能刪除');
  await prisma.ledgerEntry.delete({ where: { id: e.id } });
  await audit(req.cid, actor(req), '刪除收支', `${e.category} ${e.amount} ${dateStr(e.date)}`);
  res.json({ ok: true });
}

export async function report(req: AuthRequest, res: Response) {
  const month = parse(zPeriod, String(req.query.month ?? todayStr().slice(0, 7)));
  res.json(await monthlyReport(req.community!, month));
}

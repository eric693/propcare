import { Community, PayMethod, Prisma, Unit } from '@prisma/client';
import { prisma } from '../prisma';
import { nextDocNo, audit } from './common';
import { dateStr, periodDue, periodDiff, toDate, todayStr } from '../utils/dates';

type Tx = Prisma.TransactionClient;

/** 一戶當月管理費：有個別覆寫就用覆寫；否則每坪單價 × 坪數或每戶固定。空戶仍須繳納。 */
export function mgmtFeeOf(c: Pick<Community, 'feeMode' | 'feeRate'>, u: Pick<Unit, 'area' | 'feeOverride'>): number {
  if (u.feeOverride != null) return u.feeOverride;
  return Math.round(c.feeMode === 'AREA' ? u.area * c.feeRate : c.feeRate);
}

/**
 * 開立某期帳單。已開過的戶別略過（不會重複開）。
 * unitIds 不給就是全社區有效戶別。回傳新開立的帳單。
 */
export async function generateBills(communityId: string, period: string, unitIds?: string[], other?: { amount: number; note: string }) {
  const c = await prisma.community.findUniqueOrThrow({ where: { id: communityId } });
  const units = await prisma.unit.findMany({
    where: { communityId, active: true, ...(unitIds ? { id: { in: unitIds } } : {}) },
    include: { parkingSpaces: true },
  });
  const existing = new Set((await prisma.feeBill.findMany({
    where: { communityId, period }, select: { unitId: true },
  })).map((b) => b.unitId));
  const due = toDate(periodDue(period, c.dueDay));
  const data = units.filter((u) => !existing.has(u.id)).map((u) => {
    const amountMgmt = mgmtFeeOf(c, u);
    const amountParking = u.parkingSpaces.reduce((s, p) => s + p.monthlyFee, 0);
    const amountOther = other?.amount ?? 0;
    return {
      communityId, unitId: u.id, period, amountMgmt, amountParking, amountOther,
      otherNote: other?.note ?? '', total: amountMgmt + amountParking + amountOther, dueDate: due,
    };
  }).filter((b) => b.total > 0);
  if (data.length) await prisma.feeBill.createMany({ data, skipDuplicates: true });
  return { created: data.length, skipped: units.length - data.length, period, dueDate: dateStr(due) };
}

/** 帳單已收金額依有效收款重算狀態 */
async function refreshBill(tx: Tx, billId: string) {
  const bill = await tx.feeBill.findUniqueOrThrow({ where: { id: billId } });
  const paid = (await tx.feePayment.aggregate({ where: { billId, voided: false }, _sum: { amount: true } }))._sum.amount ?? 0;
  const status = bill.status === 'VOID' ? 'VOID' : paid <= 0 ? 'UNPAID' : paid >= bill.total ? 'PAID' : 'PARTIAL';
  return tx.feeBill.update({ where: { id: billId }, data: { paid, status } });
}

/**
 * 登錄收款：開收據、更新帳單、記入收支帳。
 * 管理費中依規約比例提撥公共基金，另記一筆在公共基金帳戶（條例第 18 條：公共基金須單獨列帳）。
 * 部分繳款依帳單中管理費佔比計算提撥額。
 */
export async function recordPayment(input: {
  communityId: string; billId: string; amount: number; method: PayMethod; paidDate: string; note?: string; by: string;
}) {
  const receiptNo = await nextDocNo('RC', input.paidDate);
  return prisma.$transaction(async (tx) => {
    const bill = await tx.feeBill.findFirst({ where: { id: input.billId, communityId: input.communityId }, include: { unit: true } });
    if (!bill) throw new HttpError(404, '找不到帳單');
    if (bill.status === 'VOID') throw new HttpError(400, '這張帳單已作廢');
    const remaining = bill.total - bill.paid;
    if (input.amount <= 0) throw new HttpError(400, '收款金額必須大於 0');
    if (input.amount > remaining) throw new HttpError(400, `收款金額超過未繳餘額 ${remaining.toLocaleString()} 元`);
    const c = await tx.community.findUniqueOrThrow({ where: { id: input.communityId } });

    const payment = await tx.feePayment.create({
      data: {
        communityId: input.communityId, billId: bill.id, unitId: bill.unitId, amount: input.amount,
        method: input.method, paidDate: toDate(input.paidDate), receiptNo, note: input.note ?? '', createdBy: input.by,
      },
    });
    const mgmtPart = bill.total ? Math.round(input.amount * bill.amountMgmt / bill.total) : 0;
    const reserve = Math.round(mgmtPart * c.reserveRatio / 100);
    const toMgmt = input.amount - reserve;
    const base = {
      communityId: input.communityId, date: toDate(input.paidDate), direction: 'IN' as const,
      paymentId: payment.id, voucherNo: receiptNo, createdBy: input.by,
      description: `${bill.unit.label} ${bill.period} 管理費`,
    };
    if (toMgmt > 0) await tx.ledgerEntry.create({ data: { ...base, fund: 'MGMT', category: '管理費收入', amount: toMgmt } });
    if (reserve > 0) await tx.ledgerEntry.create({ data: { ...base, fund: 'RESERVE', category: '公共基金提撥', amount: reserve } });
    const updated = await refreshBill(tx, bill.id);
    await audit(input.communityId, { type: 'staff', name: input.by }, '登錄收款', `${bill.unit.label} ${bill.period} ${input.amount} 元 ${receiptNo}`, tx);
    return { payment, bill: updated, reserve };
  });
}

/** 作廢收款：收據保留作廢註記（不刪除），沖掉對應的收支帳，帳單狀態重算 */
export async function voidPayment(communityId: string, paymentId: string, by: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const p = await tx.feePayment.findFirst({ where: { id: paymentId, communityId } });
    if (!p) throw new HttpError(404, '找不到收款紀錄');
    if (p.voided) throw new HttpError(400, '這筆收款已作廢');
    await tx.feePayment.update({ where: { id: p.id }, data: { voided: true, note: `${p.note}${p.note ? '；' : ''}作廢：${reason}` } });
    await tx.ledgerEntry.deleteMany({ where: { paymentId: p.id } });
    await refreshBill(tx, p.billId);
    await audit(communityId, { type: 'staff', name: by }, '作廢收款', `${p.receiptNo} ${p.amount} 元：${reason}`, tx);
  });
}

/**
 * 欠費清單：已過繳費期限、未繳清的帳單，依戶彙總。
 * 逾二期以上即符合條例第 21 條「積欠逾二期」，可經催告後訴請法院給付。
 */
export async function arrears(communityId: string, asOf = todayStr()) {
  const bills = await prisma.feeBill.findMany({
    where: { communityId, status: { in: ['UNPAID', 'PARTIAL'] }, dueDate: { lt: toDate(asOf) } },
    include: { unit: { include: { residents: { where: { active: true }, select: { name: true, phone: true, relation: true } } } } },
    orderBy: { period: 'asc' },
  });
  const byUnit = new Map<string, {
    unitId: string; label: string; ownerName: string; contacts: { name: string; phone: string }[];
    periods: string[]; amount: number; oldest: string;
  }>();
  for (const b of bills) {
    const row = byUnit.get(b.unitId) ?? {
      unitId: b.unitId, label: b.unit.label, ownerName: b.unit.ownerName,
      contacts: b.unit.residents.map((r) => ({ name: r.name, phone: r.phone })), periods: [], amount: 0, oldest: b.period,
    };
    row.periods.push(b.period);
    row.amount += b.total - b.paid;
    byUnit.set(b.unitId, row);
  }
  return [...byUnit.values()]
    .map((r) => ({ ...r, count: r.periods.length, overTwo: r.periods.length > 2, monthsSinceOldest: periodDiff(r.oldest, asOf.slice(0, 7)) }))
    .sort((a, b) => b.count - a.count || b.amount - a.amount);
}

/** 帳戶餘額（期初＋已核准收入－已核准支出），可指定截至某日 */
export async function fundBalances(c: Community, until?: string) {
  const where: Prisma.LedgerEntryWhereInput = { communityId: c.id, approval: 'APPROVED', ...(until ? { date: { lte: toDate(until) } } : {}) };
  const rows = await prisma.ledgerEntry.groupBy({ by: ['fund', 'direction'], where, _sum: { amount: true } });
  const sum = (fund: string, dir: string) => rows.find((r) => r.fund === fund && r.direction === dir)?._sum.amount ?? 0;
  return {
    mgmt: c.openingMgmt + sum('MGMT', 'IN') - sum('MGMT', 'OUT'),
    reserve: c.openingReserve + sum('RESERVE', 'IN') - sum('RESERVE', 'OUT'),
  };
}

/** 月報：期初、各科目收支、期末、當期管理費收繳率。給管委會與住戶公告使用。 */
export async function monthlyReport(c: Community, month: string) {
  const start = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const end = dateStr(new Date(Date.UTC(y, m, 0)));
  const prevDay = dateStr(new Date(Date.UTC(y, m - 1, 0)));
  const opening = await fundBalances(c, prevDay);
  const closing = await fundBalances(c, end);
  const rows = await prisma.ledgerEntry.groupBy({
    by: ['fund', 'direction', 'category'],
    where: { communityId: c.id, approval: 'APPROVED', date: { gte: toDate(start), lte: toDate(end) } },
    _sum: { amount: true },
    orderBy: { category: 'asc' },
  });
  const items = rows.map((r) => ({ fund: r.fund, direction: r.direction, category: r.category, amount: r._sum.amount ?? 0 }));
  const bills = await prisma.feeBill.aggregate({ where: { communityId: c.id, period: month, status: { not: 'VOID' } }, _sum: { total: true, paid: true }, _count: true });
  const paidCount = await prisma.feeBill.count({ where: { communityId: c.id, period: month, status: 'PAID' } });
  const pending = await prisma.ledgerEntry.count({ where: { communityId: c.id, approval: 'PENDING', date: { gte: toDate(start), lte: toDate(end) } } });
  return {
    month, opening, closing, items,
    collection: {
      billed: bills._sum.total ?? 0, paid: bills._sum.paid ?? 0, bills: bills._count, paidBills: paidCount,
      rate: bills._sum.total ? Math.round((bills._sum.paid ?? 0) / bills._sum.total * 1000) / 10 : null,
    },
    pendingApprovals: pending,
  };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

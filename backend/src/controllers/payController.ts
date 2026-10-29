import { Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { Community } from '@prisma/client';
import { prisma } from '../prisma';
import { config } from '../config';
import { AuthRequest } from '../middleware/auth';
import { ResidentRequest } from '../middleware/residentAuth';
import { audit } from '../services/common';
import { HttpError } from '../services/feeService';
import { notifyStaff, notifyUnit } from '../services/lineService';
import { checkoutForm, ECPAY_TEST, EcpayKeys, verifyMac } from '../services/ecpay';
import { parse } from '../utils/validate';
import { payUnitOldestFirst } from './feeController';

const METHODS = { Credit: '信用卡', CVS: '超商代碼', BARCODE: '超商條碼', ATM: 'ATM 轉帳' } as const;
type Method = keyof typeof METHODS;

/** 社區的綠界金鑰：測試環境未填金鑰時用綠界公開的測試特店 */
function keysOf(c: Community): EcpayKeys | null {
  if (!c.onlinePay) return null;
  if (c.ecpayMerchantId && c.ecpayHashKey && c.ecpayHashIV) return { merchantId: c.ecpayMerchantId, hashKey: c.ecpayHashKey, hashIV: c.ecpayHashIV, stage: c.ecpayStage };
  return c.ecpayStage ? ECPAY_TEST : null;
}

async function owedOf(unitId: string) {
  const bills = await prisma.feeBill.findMany({ where: { unitId, status: { in: ['UNPAID', 'PARTIAL'] } }, orderBy: { period: 'asc' } });
  return { amount: bills.reduce((s, b) => s + b.total - b.paid, 0), periods: bills.map((b) => b.period) };
}

// ── 住戶端 ────────────────────────────────────────────────────────────

export async function residentPayInfo(req: ResidentRequest, res: Response) {
  const c = req.community!, keys = keysOf(c);
  const owed = await owedOf(req.resident!.unitId);
  const pending = await prisma.onlinePayment.findMany({ where: { unitId: req.resident!.unitId, status: 'PENDING', payInfo: { not: '' } }, orderBy: { createdAt: 'desc' }, take: 3 });
  res.json({ enabled: Boolean(keys), stage: keys?.stage ?? false, methods: METHODS, ...owed, pending: pending.map((p) => ({ id: p.id, method: p.method, amount: p.amount, payInfo: p.payInfo, createdAt: p.createdAt })) });
}

/** 建立訂單，回傳要 POST 到綠界的表單欄位；金額＝目前全部未繳（由最舊期別沖銷） */
export async function residentPayCreate(req: ResidentRequest, res: Response) {
  const { method } = parse(z.object({ method: z.enum(Object.keys(METHODS) as [Method, ...Method[]]) }), req.body);
  const c = req.community!, r = req.resident!, keys = keysOf(c);
  if (!keys) throw new HttpError(400, '社區尚未開通線上繳費');
  const owed = await owedOf(r.unitId);
  if (owed.amount <= 0) throw new HttpError(400, '目前沒有未繳的管理費');
  if ((method === 'CVS' || method === 'BARCODE') && owed.amount > 20000) throw new HttpError(400, '超商繳費單筆上限 2 萬元，請改用信用卡或 ATM');
  const tradeNo = `PC${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`.slice(0, 20);
  await prisma.onlinePayment.create({ data: { communityId: c.id, unitId: r.unitId, residentId: r.id, tradeNo, method, amount: owed.amount, periods: owed.periods.join('、') } });
  const base = config.appUrl.replace(/\/$/, '');
  res.json(checkoutForm(keys, {
    tradeNo, amount: owed.amount, method, desc: 'community fee',
    itemName: `${r.unit.label} 管理費 ${owed.periods.join(' ')}`,
    returnUrl: `${base}/api/pay/ecpay/notify`, paymentInfoUrl: `${base}/api/pay/ecpay/info`, backUrl: `${base}/r/bills`,
  }));
}

// ── 綠界通知（公開端點，以檢查碼驗證來源）───────────────────────────────

async function findOrder(body: Record<string, string>) {
  const p = await prisma.onlinePayment.findUnique({ where: { tradeNo: body.MerchantTradeNo ?? '' }, include: { community: true, unit: { select: { label: true } } } });
  if (!p) return null;
  const keys = keysOf(p.community) ?? (p.community.ecpayStage ? ECPAY_TEST : null);
  if (!keys || body.MerchantID !== keys.merchantId || !verifyMac(body, keys)) return null;
  return { p, keys };
}

/** 付款結果通知（ReturnURL）：驗證 → 搶占訂單 → 整戶沖銷；一律回 1|OK，避免綠界重送 */
export async function ecpayNotify(req: Request, res: Response) {
  const body = req.body as Record<string, string>;
  const found = await findOrder(body);
  if (!found) { console.warn('[ecpay] 檢查碼或訂單不符', body.MerchantTradeNo); res.type('text').send('0|CheckMacValue Error'); return; }
  const { p, keys } = found;
  const paid = body.RtnCode === '1' && (body.SimulatePaid !== '1' || keys.stage);
  if (!paid) {
    if (p.status === 'PENDING') await prisma.onlinePayment.update({ where: { id: p.id }, data: { rtnMsg: body.RtnMsg ?? '' } });
    res.type('text').send('1|OK'); return;
  }
  // 同時收到重送時只處理一次
  const claimed = await prisma.onlinePayment.updateMany({ where: { id: p.id, status: 'PENDING' }, data: { status: 'PAID', ecpayTradeNo: body.TradeNo ?? '', paymentType: body.PaymentType ?? '', rtnMsg: body.RtnMsg ?? '', paidAt: new Date() } });
  if (!claimed.count) { res.type('text').send('1|OK'); return; }
  const method = p.method === 'Credit' ? 'CARD' : p.method === 'ATM' ? 'ATM' : 'STORE';
  const paidDate = (body.PaymentDate ?? '').slice(0, 10).replace(/\//g, '-') || new Date().toISOString().slice(0, 10);
  try {
    if (Number(body.TradeAmt) !== p.amount) throw new HttpError(400, `付款金額 ${body.TradeAmt} 與訂單 ${p.amount} 不符`);
    const receipts = await payUnitOldestFirst({ communityId: p.communityId, unitId: p.unitId, amount: p.amount, method, paidDate, note: `線上繳費 ${METHODS[p.method as Method] ?? p.method} 綠界 ${body.TradeNo ?? ''}`.trim(), by: '線上繳費' });
    await prisma.onlinePayment.update({ where: { id: p.id }, data: { receiptNos: receipts.join(',') } });
    await audit(p.communityId, { type: 'system', name: '綠界' }, '線上繳費入帳', `${p.unit.label} ${p.amount} 元 ${body.TradeNo ?? ''}`);
    await notifyUnit(p.unitId, `【${p.community.name}】已收到您的管理費 ${p.amount.toLocaleString()} 元（${METHODS[p.method as Method] ?? p.method}），收據 ${receipts.join('、')}。謝謝！`);
  } catch (e) {
    const msg = e instanceof HttpError ? e.message : '自動沖銷失敗';
    await prisma.onlinePayment.update({ where: { id: p.id }, data: { status: 'MISMATCH', rtnMsg: msg } });
    await notifyStaff(p.communityId, `【${p.community.name}】線上繳費需人工處理：${p.unit.label} 已付 ${body.TradeAmt} 元（綠界 ${body.TradeNo}），${msg}`);
    console.error('[ecpay] 入帳失敗', p.tradeNo, e);
  }
  res.type('text').send('1|OK');
}

/** 取號結果通知（PaymentInfoURL）：超商代碼／條碼／ATM 帳號，住戶專區會顯示 */
export async function ecpayPaymentInfo(req: Request, res: Response) {
  const body = req.body as Record<string, string>;
  const found = await findOrder(body);
  if (!found) { res.type('text').send('0|CheckMacValue Error'); return; }
  // 取號成功：ATM 為 2，超商代碼／條碼為 10100073
  if (body.RtnCode === '2' || body.RtnCode === '10100073') {
    const info = body.vAccount ? `${body.BankCode ?? ''} 帳號 ${body.vAccount}`
      : body.PaymentNo ? `超商代碼 ${body.PaymentNo}`
      : body.Barcode1 ? `條碼 ${body.Barcode1} / ${body.Barcode2} / ${body.Barcode3}` : '';
    await prisma.onlinePayment.update({ where: { id: found.p.id }, data: { payInfo: `${info}${body.ExpireDate ? `，繳費期限 ${body.ExpireDate}` : ''}`.trim() } });
  }
  res.type('text').send('1|OK');
}

// ── 管理端 ───────────────────────────────────────────────────────────

export async function listOnlinePayments(req: AuthRequest, res: Response) {
  res.json(await prisma.onlinePayment.findMany({ where: { communityId: req.cid! }, include: { unit: { select: { label: true } } }, orderBy: { createdAt: 'desc' }, take: 500 }));
}

/** 人工處理後標記完成（例如金額不符已另外沖帳或退款）；刪除只限未付款的訂單 */
export async function updateOnlinePayment(req: AuthRequest, res: Response) {
  const b = parse(z.object({ status: z.enum(['PAID', 'FAILED']), note: z.string().trim().max(200).default('') }), req.body);
  const p = await prisma.onlinePayment.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!p) throw new HttpError(404, '找不到線上繳費訂單');
  if (p.status === 'PAID' && b.status === 'FAILED') throw new HttpError(400, '已入帳的訂單不能改為失敗，請到收款紀錄作廢');
  await prisma.onlinePayment.update({ where: { id: p.id }, data: { status: b.status, rtnMsg: b.note || p.rtnMsg } });
  await audit(req.cid, { type: 'staff', id: req.user!.id, name: req.user!.name }, '處理線上繳費', `${p.tradeNo} → ${b.status} ${b.note}`);
  res.json({ ok: true });
}

export async function deleteOnlinePayment(req: AuthRequest, res: Response) {
  const p = await prisma.onlinePayment.findFirst({ where: { id: req.params.id, communityId: req.cid! } });
  if (!p) throw new HttpError(404, '找不到線上繳費訂單');
  if (p.status === 'PAID' || p.status === 'MISMATCH') throw new HttpError(400, '已付款的訂單保留紀錄，不能刪除');
  await prisma.onlinePayment.delete({ where: { id: p.id } });
  res.json({ ok: true });
}

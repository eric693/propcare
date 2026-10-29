// 綠界測試環境端對端測試：建臨時社區與住戶 → 住戶以信用卡付款 → 等綠界通知 → 驗證已銷帳 → 清除
// 用法：node scripts/ecpay-e2e.mjs <playwright 路徑> <截圖資料夾>
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { createRequire } from 'module';
import { PrismaClient } from '@prisma/client';

const [pwPath, out] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)(pwPath);
const prisma = new PrismaClient();
const U = process.env.APP_URL.replace(/\/$/, '');
const stamp = Date.now().toString(36);
const phone = `09${String(Date.now()).slice(-8)}`;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());

const c = await prisma.community.create({ data: { name: `zz-ecpay-${stamp}`, onlinePay: true, ecpayStage: true } });
try {
  const u = await prisma.unit.create({ data: { communityId: c.id, label: 'T 1F-1', area: 10 } });
  await prisma.resident.create({ data: { communityId: c.id, unitId: u.id, name: '測試住戶', phone, password: await bcrypt.hash('test123456', 6), mustChangePassword: false, privacyAt: new Date() } });
  await prisma.feeBill.create({ data: { communityId: c.id, unitId: u.id, period: today.slice(0, 7), amountMgmt: 1234, total: 1234, dueDate: new Date(`${today}T00:00:00Z`) } });

  // 以住戶身分建立訂單（與住戶專區按「信用卡」相同的 API）
  const login = await (await fetch(`${U}/api/resident/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password: 'test123456' }) })).json();
  const order = await (await fetch(`${U}/api/resident/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` }, body: JSON.stringify({ method: 'Credit' }) })).json();
  console.log('訂單', order.fields.MerchantTradeNo, order.fields.TotalAmount, order.action);

  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1100, height: 1000 } });
  const inputs = Object.entries(order.fields).map(([k, v]) => `<input type="hidden" name="${k}" value="${String(v).replace(/"/g, '&quot;')}">`).join('');
  await pg.setContent(`<form id="f" method="POST" action="${order.action}">${inputs}</form>`);
  await Promise.all([pg.waitForNavigation({ timeout: 30000 }), pg.evaluate(() => document.getElementById('f').submit())]);
  await pg.waitForTimeout(3000);
  await pg.screenshot({ path: `${out}/e2e-2-ecpay.png`, fullPage: true });
  console.log('綠界頁面', pg.url());
  if (process.env.STEP === 'dump') console.log(JSON.stringify(await pg.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]),select,button,a.btn')].filter((e) => e.offsetParent).map((e) => [e.tagName, e.id, e.getAttribute('name'), e.getAttribute('placeholder'), (e.textContent || '').trim().slice(0, 20)]))));
  if (process.env.STEP === 'card') {
    const fill = async (sel, v) => { const el = pg.locator(sel).first(); if (await el.count()) { await el.click(); await el.pressSequentially(v, { delay: 30 }); } else console.log('找不到欄位', sel); };
    await fill('#CCpart1', '4311'); await fill('#CCpart2', '9522'); await fill('#CCpart3', '2222'); await fill('#CCpart4', '2222');
    await fill('#CreditBackThree', '222');
    await fill('#creditMM', '12'); await fill('#creditYY', String((new Date().getFullYear() + 3) % 100));
    await fill('#CCHolderTemp', 'TEST USER'); await fill('#CellPhoneCheck', '0912345678');
    await pg.screenshot({ path: `${out}/e2e-3-filled.png`, fullPage: true });
    // 測試環境會跳出提醒視窗，關掉才能按付款
    const closeNotice = async () => { const btn = pg.getByText('關閉', { exact: true }); if (await btn.first().isVisible().catch(() => false)) await btn.first().click(); };
    await closeNotice();
    await pg.locator('#CreditPaySubmit').click();
    // 依序處理：測試環境提醒（關閉）→ 確認付款（確定）；離開付款頁即結束
    for (let i = 0; i < 12 && pg.url().includes('AioCheckOut'); i++) {
      await pg.waitForTimeout(1500);
      const close = pg.getByText('關閉', { exact: true }).first(), ok = pg.getByText('確定', { exact: true }).first();
      if (await ok.isVisible().catch(() => false)) { await ok.click().catch(() => {}); console.log('按 確定'); }
      else if (await close.isVisible().catch(() => false)) { await close.click().catch(() => {}); console.log('按 關閉'); }
      else { await pg.locator('#CreditPaySubmit').click().catch(() => {}); console.log('按 立即付款'); }
    }
    await pg.waitForTimeout(5000);
    await pg.screenshot({ path: `${out}/e2e-4-after-submit.png`, fullPage: true });
    // 3D 驗證頁：簡訊驗證碼 1234
    for (const f of [pg, ...pg.frames()]) {
      await pg.waitForTimeout(2000);
      await pg.screenshot({ path: `${out}/e2e-5-3d.png`, fullPage: true });
      const getOtp = f.getByText(/取得OTP/).first();
      if (await getOtp.isVisible().catch(() => false)) { await getOtp.click(); await pg.waitForTimeout(2500); console.log('按 取得OTP'); }
      const box = f.locator('input:visible:not([type=checkbox]):not([type=submit]):not([type=button])').first();
      if (!pg.url().includes('AioCheckOut') && await box.count().catch(() => 0)) {
        console.log('3D 頁面', pg.url().slice(0, 80));
        await box.click(); await box.pressSequentially('1234', { delay: 50 });
        await pg.screenshot({ path: `${out}/e2e-5-otp.png`, fullPage: true });
        const btn = f.locator('button:visible, input[type=submit]:visible, input[type=button]:visible, a:visible').filter({ hasText: /送出|確認|確定|Submit|驗證|OK/i }).first();
        if (await btn.count()) await btn.click(); else { const sb = f.locator('input[type=submit]:visible, input[type=button]:visible').first(); if (await sb.count()) await sb.click(); else await box.press('Enter'); }
        break;
      }
    }
    await pg.waitForTimeout(8000);
    await pg.screenshot({ path: `${out}/e2e-6-result.png`, fullPage: true });
    // 等綠界通知（最多 60 秒）
    let o;
    for (let i = 0; i < 30; i++) { o = await prisma.onlinePayment.findUnique({ where: { tradeNo: order.fields.MerchantTradeNo } }); if (o.status !== 'PENDING') break; await new Promise((r) => setTimeout(r, 2000)); }
    const bill = await prisma.feeBill.findFirst({ where: { communityId: c.id } });
    console.log('結果', o.status, o.paymentType, o.ecpayTradeNo, '收據', o.receiptNos, '帳單', bill.status, bill.paid);
  }
  await b.close();
} finally {
  if (process.env.KEEP !== '1') {
    await prisma.onlinePayment.deleteMany({ where: { communityId: c.id } });
    await prisma.ledgerEntry.deleteMany({ where: { communityId: c.id } });
    await prisma.feePayment.deleteMany({ where: { communityId: c.id } });
    await prisma.feeBill.deleteMany({ where: { communityId: c.id } });
    await prisma.resident.deleteMany({ where: { communityId: c.id } });
    await prisma.unit.deleteMany({ where: { communityId: c.id } });
    await prisma.auditLog.deleteMany({ where: { communityId: c.id } });
    await prisma.community.delete({ where: { id: c.id } });
  }
  await prisma.$disconnect();
}

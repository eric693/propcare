// 全系統 API 煙霧測試：建立臨時社區與帳號，逐一呼叫 API（含權限、社區隔離、住戶端），最後全部清除。
// 不碰既有社區資料；臨時住戶沒有 LINE，不會推播給真人。
// 用法：node scripts/smoke-test.mjs   （預設打 http://127.0.0.1:3390/api）
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const API = process.env.API ?? 'http://127.0.0.1:3390/api';
const prisma = new PrismaClient();
const stamp = Date.now().toString(36);
const results = [];

async function call(method, path, { token, cid, body, expect = [200, 201], label } = {}) {
  let status = 0, data = null;
  try {
    const res = await fetch(API + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cid ? { 'X-Community': cid } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    status = res.status;
    const text = await res.text();
    try { data = JSON.parse(text); } catch { data = text; }
  } catch (e) { data = String(e); }
  const ok = expect.includes(status);
  results.push({ ok, label: `${method} ${label ?? path}`, status, error: ok ? '' : JSON.stringify(data).slice(0, 200) });
  return data;
}
function check(label, cond, detail = '') { results.push({ ok: !!cond, label: `檢查 ${label}`, status: cond ? 'OK' : 'FAIL', error: cond ? '' : detail }); }

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const period = today.slice(0, 7);
const plus = (n) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

let cid, other, uMgr, uCom;
async function setup() {
  const pw = await bcrypt.hash('smoke12345', 6);
  const c = await prisma.community.create({ data: { name: `zz-smoke-${stamp}`, feeMode: 'AREA', feeRate: 100, reserveRatio: 20, dueDay: 28 } });
  const o = await prisma.community.create({ data: { name: `zz-smoke-other-${stamp}` } });
  cid = c.id; other = o.id;
  uMgr = await prisma.user.create({ data: { username: `zz-mgr-${stamp}`, password: pw, name: '測試總幹事', role: 'MANAGER', communities: { create: { communityId: cid } } } });
  uCom = await prisma.user.create({ data: { username: `zz-com-${stamp}`, password: pw, name: '測試委員', role: 'COMMITTEE', communities: { create: { communityId: cid } } } });
}

async function cleanup() {
  for (const id of [cid, other].filter(Boolean)) {
    await prisma.motionVote.deleteMany({ where: { motion: { meeting: { communityId: id } } } });
    await prisma.meetingAttendance.deleteMany({ where: { meeting: { communityId: id } } });
    await prisma.meeting.deleteMany({ where: { communityId: id } });
    for (const m of ['ledgerEntry', 'feePayment', 'feeBill', 'package', 'booking', 'facility', 'repair', 'announcement', 'inspection', 'contract', 'vendor', 'parkingSpace', 'resident', 'unit', 'userCommunity', 'auditLog']) {
      await prisma[m].deleteMany({ where: { communityId: id } });
    }
    await prisma.community.delete({ where: { id } });
  }
  await prisma.user.deleteMany({ where: { username: { startsWith: `zz-` , endsWith: stamp } } });
  await prisma.docCounter.deleteMany({ where: { prefix: 'RC', n: 0 } });
}

async function main() {
  await setup();
  // ── 登入與權限 ──
  await call('POST', '/auth/login', { body: { username: uMgr.username, password: 'wrong' }, expect: [401], label: '/auth/login（錯誤密碼）' });
  const M = (await call('POST', '/auth/login', { body: { username: uMgr.username, password: 'smoke12345' } })).token;
  const C = (await call('POST', '/auth/login', { body: { username: uCom.username, password: 'smoke12345' } })).token;
  const me = await call('GET', '/auth/me', { token: M });
  check('總幹事只看得到指派的社區', me.communities?.length === 1 && me.communities[0].id === cid, JSON.stringify(me.communities));
  await call('GET', '/dashboard', { token: M, cid: other, expect: [403], label: '/dashboard（未指派的社區應拒絕）' });
  await call('GET', '/dashboard', { token: M, expect: [400], label: '/dashboard（未帶社區）' });
  await call('GET', '/users', { token: M, expect: [403], label: '/users（非管理員）' });
  await call('PUT', '/community', { token: M, cid, body: { feeRate: 1 }, expect: [403], label: '/community（非管理員不能改設定）' });

  // ── 戶別、住戶、車位 ──
  const imp = await call('POST', '/units/import', { token: M, cid, body: { text: 'A 1F-1\tA\t1F\t1\t30\t30\t甲\nA 1F-2\tA\t1F\t2\t20\t20\t乙\nA 2F-1\tA\t2F\t1\t25\t25\t丙\nA 2F-2\tA\t2F\t2\t25\t25\t丁\nbad,line,x,y,notnum' } });
  check('批次匯入 4 戶並回報錯誤行', imp.created === 4 && imp.errors?.length === 1, JSON.stringify(imp));
  const units = await call('GET', '/units', { token: M, cid });
  const U = Object.fromEntries(units.map((u) => [u.label, u.id]));
  const phone = `09${String(Date.now()).slice(-8)}`;
  await call('POST', '/residents', { token: M, cid, body: { unitId: U['A 1F-1'], name: '測試住戶', phone } });
  await call('POST', '/residents', { token: M, cid, body: { unitId: U['A 1F-2'], name: '重複手機', phone }, expect: [409], label: '/residents（同社區手機重複）' });
  await call('POST', '/residents', { token: M, cid, body: { unitId: U['A 1F-2'], name: 'x', phone: '12345' }, expect: [400], label: '/residents（手機格式錯）' });
  await call('POST', '/parking', { token: M, cid, body: { code: 'B1-01', unitId: U['A 1F-1'], monthlyFee: 500 } });
  await call('POST', '/units', { token: C, cid, body: { label: 'X' }, expect: [403], label: '/units（委員唯讀）' });

  // ── 管理費：開帳、收款、拆公共基金、作廢、欠費 ──
  const gen = await call('POST', '/bills/generate', { token: M, cid, body: { period } });
  check('開立 4 張帳單', gen.created === 4, JSON.stringify(gen));
  const again = await call('POST', '/bills/generate', { token: M, cid, body: { period } });
  check('重複開帳不會重開', again.created === 0, JSON.stringify(again));
  const bills = await call('GET', `/bills?period=${period}`, { token: M, cid });
  const b1 = bills.find((b) => b.unitId === U['A 1F-1']);
  check('管理費 = 坪數×單價、加車位費', b1?.amountMgmt === 3000 && b1?.amountParking === 500 && b1?.total === 3500, JSON.stringify(b1));
  await call('POST', '/payments', { token: M, cid, body: { billId: b1.id, amount: 9999 }, expect: [400], label: '/payments（超過未繳）' });
  const pay = await call('POST', '/payments', { token: M, cid, body: { billId: b1.id, amount: 3500, method: 'CASH', paidDate: today } });
  // 3500 中管理費佔 3000，提撥 20% = 600
  check('收款自動提撥公共基金 600', pay.reserve === 600, JSON.stringify(pay).slice(0, 200));
  const led = await call('GET', `/ledger?month=${period}`, { token: M, cid });
  check('帳戶餘額：管理費 2900、公共基金 600', led.balance?.mgmt === 2900 && led.balance?.reserve === 600, JSON.stringify(led.balance));
  await call('POST', `/payments/${pay.payment.id}/void`, { token: M, cid, body: { reason: '測試作廢' } });
  const led2 = await call('GET', `/ledger?month=${period}`, { token: M, cid });
  check('作廢收款後沖回收支帳', led2.balance?.mgmt === 0 && led2.balance?.reserve === 0, JSON.stringify(led2.balance));
  const unitPay = await call('POST', '/payments/unit', { token: M, cid, body: { unitId: U['A 1F-2'], amount: 1000 } });
  check('整戶收款開收據', unitPay.receipts?.length === 1, JSON.stringify(unitPay));
  await call('GET', '/arrears', { token: M, cid });
  await call('GET', `/report?month=${period}`, { token: C, cid, label: '/report（委員可看）' });

  // ── 支出核准 ──
  const exp = await call('POST', '/ledger', { token: M, cid, body: { date: today, direction: 'OUT', category: '清潔費', amount: 800 } });
  check('支出預設待核准', exp.approval === 'PENDING', JSON.stringify(exp).slice(0, 120));
  await call('POST', `/ledger/${exp.id}/approve`, { token: M, cid, body: { approve: true }, expect: [403], label: '/ledger/approve（總幹事不能自己核准）' });
  await call('POST', `/ledger/${exp.id}/approve`, { token: C, cid, body: { approve: true }, label: '/ledger/approve（委員核准）' });
  await call('POST', '/ledger', { token: M, cid, body: { date: today, direction: 'IN', category: '管理費收入', amount: 1 }, expect: [400], label: '/ledger（管理費收入不能手記）' });

  // ── 包裹 ──
  const pk = await call('POST', '/packages', { token: M, cid, body: { unitId: U['A 1F-1'], carrier: '黑貓', count: 2 } });
  check('一次登記 2 件、取件碼不同', pk.packages?.length === 2 && pk.packages[0].pickupCode !== pk.packages[1].pickupCode, JSON.stringify(pk).slice(0, 200));
  await call('POST', '/packages/pickup', { token: M, cid, body: { code: pk.packages[0].pickupCode } });
  await call('POST', '/packages/pickup', { token: M, cid, body: { code: pk.packages[0].pickupCode }, expect: [404], label: '/packages/pickup（重複領取）' });

  // ── 公設預約 ──
  await call('POST', '/facilities', { token: M, cid, body: { name: '健身房', openTime: '08:00', closeTime: '12:00', slotMinutes: 60, capacity: 1, maxPerWeek: 2, advanceDays: 7 } });
  const fac = (await call('GET', '/facilities', { token: M, cid }))[0];
  const d = plus(2);
  await call('POST', '/bookings', { token: M, cid, body: { facilityId: fac.id, unitId: U['A 2F-1'], date: d, startTime: '09:00' } });
  await call('POST', '/bookings', { token: M, cid, body: { facilityId: fac.id, unitId: U['A 2F-2'], date: d, startTime: '09:00' }, expect: [409], label: '/bookings（額滿）' });
  await call('POST', '/bookings', { token: M, cid, body: { facilityId: fac.id, unitId: U['A 2F-2'], date: d, startTime: '09:30' }, expect: [400], label: '/bookings（時段沒對齊）' });
  await call('POST', '/bookings', { token: M, cid, body: { facilityId: fac.id, unitId: U['A 2F-2'], date: plus(30), startTime: '09:00' }, expect: [400], label: '/bookings（超過可提前天數）' });

  // ── 報修、公告、法定檢查 ──
  const rep = await call('POST', '/repairs', { token: M, cid, body: { title: '燈不亮', unitId: U['A 1F-1'] } });
  await call('PUT', `/repairs/${rep.id}`, { token: M, cid, body: { status: 'DONE', log: '已更換', cost: 300 } });
  await call('POST', '/announcements', { token: M, cid, body: { title: '測試公告', body: '內容' } });
  const ins = await call('POST', '/inspections', { token: M, cid, body: { title: '水塔清洗', dueDate: today, cycleMonths: 6 } });
  const insList = await call('GET', '/inspections', { token: M, cid });
  const done = await call('POST', `/inspections/${insList[0].id}/complete`, { token: M, cid, body: { result: '合格' } });
  check('完成檢查自動排下一次（6 個月後）', !!done.next && done.next > plus(150), JSON.stringify(done));

  // ── 區權會：一般與重新召集門檻 ──
  const mt = await call('POST', '/meetings', { token: M, cid, body: { title: '區權會', meetingDate: plus(5), noticeDate: today } });
  check('通知不足 10 日會警示', mt.notice && !mt.notice.ok, JSON.stringify(mt.notice));
  // 4 戶比例 30/20/25/25：3 戶出席（30+20+25=75%）→ 人數 75%、比例 75%，達 2/3
  for (const l of ['A 1F-1', 'A 1F-2', 'A 2F-1']) await call('POST', `/meetings/${mt.id}/attendance`, { token: M, cid, body: { unitId: U[l], present: true } });
  let r = await call('POST', `/meetings/${mt.id}/motions`, { token: M, cid, body: { title: '議案一' } });
  check('3/4 戶出席達法定人數', r.quorum?.met === true, JSON.stringify(r.quorum));
  const mo = r.motions[0].id;
  r = await call('PUT', `/meetings/${mt.id}/motions/${mo}/votes`, { token: M, cid, body: { votes: { [U['A 1F-1']]: 'YES', [U['A 1F-2']]: 'YES', [U['A 2F-1']]: 'NO' } } });
  // 同意 2/3 戶 = 66.7% < 75% → 不通過
  check('2/3 同意未達 3/4，不通過', r.motions[0].result.passed === false, JSON.stringify(r.motions[0].result));
  await call('PUT', `/meetings/${mt.id}/motions/${mo}/votes`, { token: M, cid, body: { votes: { [U['A 2F-2']]: 'YES' } }, expect: [400], label: '/votes（未簽到不能投）' });
  await call('PUT', `/meetings/${mt.id}`, { token: M, cid, body: { title: '區權會（重新召集）', meetingDate: plus(5), noticeDate: today, reconvene: true } });
  r = await call('GET', `/meetings/${mt.id}`, { token: M, cid });
  // 重新召集：過半數即可 → 2/3 同意、比例 50/75=66.7% → 通過
  check('重新召集：過半同意即通過', r.motions[0].result.passed === true, JSON.stringify(r.motions[0].result));

  // ── 住戶端 ──
  await call('POST', '/resident/login', { body: { phone, password: 'wrong' }, expect: [401], label: '/resident/login（錯誤密碼）' });
  const rl = await call('POST', '/resident/login', { body: { phone, password: phone.slice(-6) } });
  check('住戶首次登入須改密碼', rl.mustChangePassword === true, JSON.stringify(rl).slice(0, 100));
  const R = rl.token;
  await call('GET', '/dashboard', { token: R, cid, expect: [401], label: '/dashboard（住戶 token 不能打員工 API）' });
  await call('GET', '/resident/me', { token: M, expect: [401], label: '/resident/me（員工 token 不能打住戶 API）' });
  await call('PUT', '/resident/password', { token: R, body: { currentPassword: phone.slice(-6), newPassword: phone.slice(-6) + '00' } });
  const home = await call('GET', '/resident/home', { token: R });
  check('住戶首頁看到自己的待領包裹', home.packages?.length === 1, JSON.stringify(home.packages));
  await call('GET', '/resident/bills', { token: R });
  await call('POST', '/resident/bookings', { token: R, body: { facilityId: fac.id, date: d, startTime: '10:00' } });
  await call('POST', '/resident/bookings', { token: R, body: { facilityId: fac.id, date: d, startTime: '11:00' } });
  await call('POST', '/resident/bookings', { token: R, body: { facilityId: fac.id, date: d, startTime: '08:00' }, expect: [409], label: '/resident/bookings（每週上限）' });
  const rr = await call('POST', '/resident/repairs', { token: R, body: { title: '水龍頭漏水', area: 'PRIVATE' } });
  const myRep = await call('GET', '/resident/repairs', { token: R });
  check('住戶看不到報修費用', myRep.length >= 1 && !('cost' in myRep[0]), JSON.stringify(myRep[0]).slice(0, 120));
  await call('GET', '/resident/report', { token: R });
  await call('GET', '/resident/meetings', { token: R });
  check('住戶報修單號', /^R\d{11}$/.test(rr.repairNo ?? ''), rr.repairNo);
}

main()
  .catch((e) => results.push({ ok: false, label: '例外', status: 'ERR', error: String(e.stack ?? e) }))
  .finally(async () => {
    await cleanup().catch((e) => console.error('清除失敗', e));
    await prisma.$disconnect();
    const fail = results.filter((r) => !r.ok);
    for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.label} ${r.ok ? '' : `→ ${r.status} ${r.error}`}`);
    console.log(`\n${results.length - fail.length}/${results.length} 通過`);
    process.exit(fail.length ? 1 : 0);
  });

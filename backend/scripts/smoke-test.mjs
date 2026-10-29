// 全系統 API 煙霧測試：建立臨時社區與帳號，逐一呼叫 API（含權限、社區隔離、住戶端），最後全部清除。
// 不碰既有社區資料；臨時住戶沒有 LINE，不會推播給真人。
// 用法：node scripts/smoke-test.mjs   （預設打 http://127.0.0.1:3390/api）
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import fs from 'fs';
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

let cid, other, uMgr, uCom, uAdm;
async function setup() {
  const pw = await bcrypt.hash('smoke12345', 6);
  const c = await prisma.community.create({ data: { name: `zz-smoke-${stamp}`, feeMode: 'AREA', feeRate: 100, reserveRatio: 20, dueDay: 28 } });
  const o = await prisma.community.create({ data: { name: `zz-smoke-other-${stamp}` } });
  cid = c.id; other = o.id;
  uMgr = await prisma.user.create({ data: { username: `zz-mgr-${stamp}`, password: pw, name: '測試總幹事', role: 'MANAGER', communities: { create: { communityId: cid } } } });
  uCom = await prisma.user.create({ data: { username: `zz-com-${stamp}`, password: pw, name: '測試委員', role: 'COMMITTEE', communities: { create: { communityId: cid } } } });
  uAdm = await prisma.user.create({ data: { username: `zz-adm-${stamp}`, password: pw, name: '測試管理員', role: 'ADMIN' } });
}

async function cleanup() {
  for (const id of [cid, other].filter(Boolean)) {
    await prisma.motionVote.deleteMany({ where: { motion: { meeting: { communityId: id } } } });
    await prisma.meetingAttendance.deleteMany({ where: { meeting: { communityId: id } } });
    await prisma.meeting.deleteMany({ where: { communityId: id } });
    await prisma.poll.deleteMany({ where: { communityId: id } });
    await prisma.patrolLog.deleteMany({ where: { communityId: id } });
    await prisma.onlinePayment.deleteMany({ where: { communityId: id } });
    for (const m of ['patrolPoint', 'bankTxn', 'dunning', 'visitor', 'feedback', 'document', 'asset']) await prisma[m].deleteMany({ where: { communityId: id } });
    fs.rmSync(new URL(`../uploads/${id}`, import.meta.url), { recursive: true, force: true });
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
  const emptyDash = await call('GET', '/dashboard', { token: M, cid, label: '/dashboard（全新社區）' });
  const ec = emptyDash.charts;
  check('全新社區的工作台圖表為 6 個月、皆無資料', ec?.collection?.length === 6 && ec.cashflow.length === 6 && ec.collection.every((m) => m.rate === null)
    && ec.cashflow.every((m) => m.income === 0 && m.expense === 0) && ec.expenseByCategory.length === 0 && ec.repairsByCategory.length === 0, JSON.stringify(ec).slice(0, 200));
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
  const ch = (await call('GET', '/dashboard', { token: M, cid, label: '/dashboard（圖表資料）' })).charts;
  const cur = ch?.collection?.at(-1), flow = ch?.cashflow?.at(-1);
  // 3500 那筆已作廢，只剩整戶收款 1000；應收 4 戶共 10500
  check('工作台圖表：本月收繳率、收支、支出科目、報修類別', cur?.period === period && cur.paid === 1000 && cur.rate === 9.5
    && flow.income === 1000 && flow.expense === 800 && ch.expenseByCategory.some((e) => e.label === '清潔費' && e.value === 800)
    && ch.repairsByCategory.reduce((s, r) => s + r.value, 0) === 1, JSON.stringify({ cur, flow, e: ch?.expenseByCategory, r: ch?.repairsByCategory }));
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
  await call('PUT', `/resident/repairs/${rr.id}`, { token: R, body: { title: '水龍頭漏水（補充）', area: 'PRIVATE', description: '廚房' } });
  const rr2 = await call('POST', '/resident/repairs', { token: R, body: { title: '待撤回' } });
  await call('DELETE', `/resident/repairs/${rr2.id}`, { token: R, label: '/resident/repairs/:id（撤回）' });
  await call('PUT', `/repairs/${rr.id}`, { token: M, cid, body: { status: 'ASSIGNED' } });
  await call('PUT', `/resident/repairs/${rr.id}`, { token: R, body: { title: 'x' }, expect: [400], label: '/resident/repairs/:id（已處理不能改）' });
  await call('DELETE', `/resident/repairs/${rr.id}`, { token: R, expect: [400], label: '/resident/repairs/:id（已處理不能撤回）' });

  // ── 編輯、刪除、改期（各模組）──
  const A = (await call('POST', '/auth/login', { body: { username: uAdm.username, password: 'smoke12345' } })).token;
  const b2 = bills.find((b) => b.unitId === U['A 2F-2']);
  await call('DELETE', `/bills/${b2.id}`, { token: M, cid, label: '/bills/:id（無收款可刪）' });
  await call('DELETE', `/bills/${b1.id}`, { token: M, cid, expect: [400], label: '/bills/:id（有收款紀錄不能刪）' });
  const pays = await call('GET', `/payments?from=${period}-01&to=${today}`, { token: M, cid });
  const live = pays.find((p) => !p.voided);
  await call('PUT', `/payments/${live.id}`, { token: M, cid, body: { method: 'ATM', paidDate: `${period}-01`, note: '改日期' } });
  const moved = await prisma.ledgerEntry.findFirst({ where: { paymentId: live.id } });
  check('修改收款日期同步收支帳日期', moved?.date.toISOString().slice(0, 10) === `${period}-01`, moved?.date);
  await call('PUT', `/payments/${pays.find((p) => p.voided).id}`, { token: M, cid, body: { note: 'x' }, expect: [400], label: '/payments/:id（已作廢不能改）' });
  const upd = await call('PUT', `/ledger/${exp.id}`, { token: M, cid, body: { date: today, fund: 'MGMT', direction: 'OUT', category: '清潔費', amount: 900, description: '改金額' } });
  check('已核准支出被總幹事修改後須重新核准', upd.reapprove === true, JSON.stringify(upd));
  const autoEntry = await prisma.ledgerEntry.findFirst({ where: { communityId: cid, paymentId: { not: null } } });
  await call('PUT', `/ledger/${autoEntry.id}`, { token: M, cid, body: { date: today, fund: 'MGMT', direction: 'IN', category: '其他收入', amount: 1 }, expect: [400], label: '/ledger/:id（收款自動入帳不能改）' });
  await call('PUT', `/packages/${pk.packages[1].id}`, { token: M, cid, body: { unitId: U['A 2F-1'], carrier: '新竹物流', kind: 'COLD' } });
  await call('DELETE', `/packages/${pk.packages[0].id}`, { token: M, cid, expect: [400], label: '/packages/:id（已領取不能刪）' });
  await call('DELETE', `/packages/${pk.packages[1].id}`, { token: M, cid, label: '/packages/:id（登記錯誤刪除）' });
  const bks = await call('GET', `/bookings?from=${today}&to=${plus(7)}`, { token: M, cid });
  const bk = bks.find((x) => x.status === 'BOOKED');
  const moved2 = await call('PUT', `/bookings/${bk.id}`, { token: M, cid, body: { facilityId: fac.id, unitId: bk.unitId, date: d, startTime: '08:00' } });
  check('預約改期成功', moved2.startTime === '08:00', JSON.stringify(moved2).slice(0, 120));
  await call('PUT', `/bookings/${moved2.id}`, { token: M, cid, body: { facilityId: fac.id, unitId: bk.unitId, date: d, startTime: '10:00' }, expect: [409], label: '/bookings/:id（改到額滿時段）' });
  const still = await prisma.booking.findUnique({ where: { id: moved2.id } });
  check('改期失敗時保留原預約', still?.status === 'BOOKED' && still.startTime === '08:00', JSON.stringify(still));
  await call('PUT', `/repairs/${rep.id}`, { token: M, cid, body: { title: '走道燈不亮（改）', location: '2F', category: '照明' } });
  await call('DELETE', `/repairs/${rep.id}`, { token: M, cid, expect: [403], label: '/repairs/:id（有費用須管理員刪）' });
  await call('DELETE', `/repairs/${rep.id}`, { token: A, cid, label: '/repairs/:id（管理員刪除）' });
  const delFac = await call('DELETE', `/facilities/${fac.id}`, { token: M, cid: cid, expect: [200], label: '/facilities/:id（有預約改停用）' });
  check('有預約的設施改為停用', delFac.deactivated === true, JSON.stringify(delFac));
  await call('POST', '/facilities', { token: M, cid, body: { name: '暫存設施' } });
  const tmpFac = (await call('GET', '/facilities', { token: M, cid })).find((x) => x.name === '暫存設施');
  const delFac2 = await call('DELETE', `/facilities/${tmpFac.id}`, { token: M, cid });
  check('沒有預約的設施直接刪除', delFac2.deactivated === false, JSON.stringify(delFac2));
  await call('DELETE', `/users/${uAdm.id}`, { token: A, expect: [400], label: '/users/:id（不能刪自己）' });
  const tmpUser = await call('POST', '/users', { token: A, body: { username: `zz-tmp-${stamp}`, name: '暫存', role: 'MANAGER', password: 'tmp123456', communityIds: [cid] } });
  await call('DELETE', `/users/${tmpUser.id}`, { token: A });
  await call('POST', '/community/deactivate', { token: A, cid: other, body: { confirmName: '錯的名字' }, expect: [400], label: '/community/deactivate（名稱不符）' });
  await call('POST', '/community/deactivate', { token: A, cid: other, body: { confirmName: `zz-smoke-other-${stamp}` } });
  const afterDeact = await call('GET', '/communities', { token: A });
  check('停用的社區不再出現在清單', !afterDeact.some((c) => c.id === other), '');

  // ── 法規：第 32 條異議期、第 34 條會議紀錄期限 ──
  await call('PUT', `/meetings/${mt.id}`, { token: M, cid, body: { title: '區權會（重新召集）', meetingDate: today, noticeDate: plus(-12), reconvene: true, status: 'HELD' } });
  let mr = await call('GET', `/meetings/${mt.id}`, { token: M, cid });
  check('重新召集決議未送達 → 待送達並公告', mr.motions[0].finality?.status === 'NEED_NOTICE', JSON.stringify(mr.motions[0].finality));
  check('會議紀錄期限提醒（重新召集 10 日）', mr.minutesCheck?.deadline === plus(10) && mr.minutesCheck.ok === false, JSON.stringify(mr.minutesCheck));
  await call('PUT', `/meetings/${mt.id}`, { token: M, cid, body: { title: '區權會（重新召集）', meetingDate: today, noticeDate: plus(-12), reconvene: true, status: 'HELD', minutesSentDate: today } });
  mr = await call('PUT', `/meetings/${mt.id}/motions/${mo}/objections`, { token: M, cid, body: { unitIds: [U['A 1F-1'], U['A 1F-2'], U['A 2F-1']] } });
  check('書面反對 3/4 戶且比例 75% → 決議不成立', mr.motions[0].finality?.status === 'OBJECTED', JSON.stringify(mr.motions[0].finality));
  mr = await call('PUT', `/meetings/${mt.id}/motions/${mo}/objections`, { token: M, cid, body: { unitIds: [U['A 1F-2']] } });
  check('反對未過半 → 異議期中', mr.motions[0].finality?.status === 'OBJECTION_PERIOD' && mr.motions[0].objections.length === 1, JSON.stringify(mr.motions[0].finality));
  const rm = await call('GET', '/resident/meetings', { token: R });
  check('住戶看不到逐戶反對與權重', rm.every((m) => !m.result || (!('weights' in m.result.quorum) && m.result.motions.every((x) => !('objections' in x)))), JSON.stringify(rm).slice(0, 200));

  // ── 欠費催告標準可設定、催告送達紀錄 ──
  let arr = await call('GET', '/arrears', { token: M, cid });
  check('預設欠滿 3 期才列為逾二期', arr.length > 0 && arr.every((x) => !x.overTwo), JSON.stringify(arr.map((x) => [x.count, x.overTwo])));
  await call('PUT', '/community', { token: A, cid, body: { arrearsPeriods: 1 } });
  arr = await call('GET', '/arrears', { token: M, cid });
  check('改成 1 期後列為可催告', arr.every((x) => x.overTwo), JSON.stringify(arr.map((x) => [x.count, x.overTwo])));
  await call('PUT', '/community', { token: A, cid, body: { arrearsPeriods: 3, arrearsAmount: 100 } });
  arr = await call('GET', '/arrears', { token: M, cid });
  check('欠費達相當金額也列為可催告', arr.every((x) => x.overTwo), JSON.stringify(arr.map((x) => [x.amount, x.overTwo])));
  await call('PUT', '/community', { token: A, cid, body: { arrearsAmount: 0 } });
  await call('POST', '/dunnings', { token: M, cid, body: { unitId: U['A 2F-1'], method: '存證信函', trackingNo: 'TP123', amount: 2500, periods: period } });
  const dun = await call('GET', `/dunnings?unitId=${U['A 2F-1']}`, { token: M, cid });
  await call('PUT', `/dunnings/${dun[0].id}`, { token: M, cid, body: { unitId: U['A 2F-1'], method: '存證信函', trackingNo: 'TP123', deliveredDate: today, receivedBy: '本人' } });
  check('催告寄送與送達紀錄', dun.length === 1 && (await call('GET', '/dunnings', { token: M, cid }))[0].receivedBy === '本人');
  await call('POST', '/dunnings', { token: C, cid, body: { unitId: U['A 2F-1'] }, expect: [403], label: '/dunnings（委員唯讀）' });

  // ── 虛擬帳號與銀行入帳匯入 ──
  await call('PUT', '/community', { token: A, cid, body: { vaPrefix: '123', vaBank: '測試銀行' } });
  await call('PUT', '/community', { token: A, cid, body: { vaPrefix: 'ab' }, expect: [400], label: '/community（虛擬帳號前綴須為數字）' });
  const vaUnits = await call('GET', '/units', { token: M, cid });
  const va = Object.fromEntries(vaUnits.map((u) => [u.label, u.vaCode]));
  check('每戶產生 14 碼虛擬帳號', vaUnits.every((u) => /^123\d{11}$/.test(u.vaCode)) && new Set(Object.values(va)).size === vaUnits.length, JSON.stringify(va));
  const meVa = await call('GET', '/resident/me', { token: R });
  check('住戶看得到自己的虛擬帳號', meVa.vaCode === va['A 1F-1'] && meVa.community.vaBank === '測試銀行', JSON.stringify(meVa).slice(0, 200));
  const csv = `交易日期,摘要,存入金額,虛擬帳號\n115/${period.slice(5)}/${today.slice(8)},ATM轉入,"1,200",${va['A 2F-1']}\n${today},跨行,99999,${va['A 2F-2']}\n${today},不明款,500,99999999999999`;
  const pv = await call('POST', '/bank/preview', { token: M, cid, body: { text: csv } });
  check('入帳明細：民國日期、千分位金額、比對虛擬帳號', pv.rows?.length === 3 && pv.rows[0].date === today && pv.rows[0].amount === 1200 && pv.rows[0].unitLabel === 'A 2F-1' && !pv.rows[2].unitId, JSON.stringify(pv.rows?.[0]));
  const ap = await call('POST', '/bank/apply', { token: M, cid, body: { rows: pv.rows.slice(0, 2).map((r) => ({ ...r })) } });
  check('入帳成功沖銷，超過欠費的那筆被擋下', ap.results?.[0].ok === true && ap.results[0].receipts.length >= 1 && ap.results[1].ok === false, JSON.stringify(ap.results));
  const pv2 = await call('POST', '/bank/preview', { token: M, cid, body: { text: csv } });
  check('同一筆入帳不會重複匯入', pv2.rows[0].duplicate === true && pv2.rows[1].duplicate === false, JSON.stringify(pv2.rows.map((r) => r.duplicate)));
  const ap2 = await call('POST', '/bank/apply', { token: M, cid, body: { rows: [pv.rows[0]] } });
  check('重送已匯入的入帳會被拒絕', ap2.results[0].ok === false, JSON.stringify(ap2.results));

  // ── 訪客、寄放物品 ──
  await call('POST', '/visitors', { token: M, cid, body: { unitId: U['A 1F-1'], name: '訪客甲', headcount: 2, plate: 'ABC-1234' } });
  let vis = await call('GET', '/visitors?inside=1', { token: M, cid });
  check('訪客登記後在場', vis.length === 1 && vis[0].unit.label === 'A 1F-1', JSON.stringify(vis));
  await call('POST', `/visitors/${vis[0].id}/leave`, { token: M, cid });
  vis = await call('GET', '/visitors?inside=1', { token: M, cid });
  check('訪客離開後不在場', vis.length === 0);
  await call('POST', '/visitors', { token: M, cid, body: { name: '' }, expect: [400], label: '/visitors（姓名必填）' });
  const dep = await call('POST', '/packages', { token: M, cid, body: { unitId: U['A 1F-1'], kind: 'DEPOSIT', recipient: '朋友小王', depositor: '測試住戶' } });
  check('寄放物品產生取件碼', dep.packages?.[0]?.kind === 'DEPOSIT' && /^\d+$/.test(dep.packages[0].pickupCode) && dep.packages[0].depositor === '測試住戶', JSON.stringify(dep).slice(0, 200));

  // ── 意見反映 ──
  const fb = await call('POST', '/resident/feedback', { token: R, body: { category: '噪音', title: '樓上半夜施工', content: '連續三天' } });
  await call('POST', '/resident/feedback', { token: R, body: { category: '亂寫', title: 'x' }, expect: [400], label: '/resident/feedback（類別不正確）' });
  const fbs = await call('GET', '/feedback', { token: M, cid });
  check('管理端看到住戶意見', fbs.some((f) => f.id === fb.id && f.unit.label === 'A 1F-1'));
  await call('PUT', `/feedback/${fb.id}`, { token: M, cid, body: { reply: '已通知該戶', status: 'REPLIED' } });
  const myFb = await call('GET', '/resident/feedback', { token: R });
  check('住戶看到回覆', myFb[0].reply === '已通知該戶' && myFb[0].status === 'REPLIED');
  await call('DELETE', `/resident/feedback/${fb.id}`, { token: R, expect: [400], label: '/resident/feedback/:id（已回覆不能撤回）' });

  // ── 社區文件 ──
  const pdf = Buffer.from('%PDF-1.4 test').toString('base64');
  const doc = await call('POST', '/documents', { token: M, cid, body: { title: '社區規約', category: '規約', fileName: '規約.pdf', mime: 'application/pdf', data: pdf } });
  await call('POST', '/documents', { token: M, cid, body: { title: '惡意', fileName: 'x.exe', mime: 'application/x-msdownload', data: pdf }, expect: [400], label: '/documents（拒絕執行檔）' });
  await call('POST', '/documents', { token: M, cid, body: { title: '內部', category: '內部', forResidents: false, fileName: 'a.txt', mime: 'text/plain', data: Buffer.from('internal').toString('base64') } });
  const rdocs = await call('GET', '/resident/documents', { token: R });
  check('住戶只看到公開的文件', rdocs.length === 1 && rdocs[0].title === '社區規約', JSON.stringify(rdocs));
  const fileRes = await fetch(`${API}/resident/documents/${doc.id}/file`, { headers: { Authorization: `Bearer ${R}` } });
  check('住戶可下載公開文件', fileRes.status === 200 && (await fileRes.text()).startsWith('%PDF'), fileRes.status);
  const internal = (await call('GET', '/documents', { token: M, cid })).find((d) => !d.forResidents);
  await call('GET', `/resident/documents/${internal.id}/file`, { token: R, expect: [404], label: '/resident/documents/:id/file（內部文件住戶不能下載）' });
  await call('DELETE', `/documents/${internal.id}`, { token: M, cid });

  // ── 意見調查（一戶一票）──
  await call('POST', '/polls', { token: M, cid, body: { title: '中庭要不要裝涼亭', options: ['要', '不要'], endDate: plus(7) } });
  const poll = (await call('GET', '/polls', { token: M, cid })).polls[0];
  await call('POST', `/resident/polls/${poll.id}/vote`, { token: R, body: { option: 0 } });
  await call('POST', `/resident/polls/${poll.id}/vote`, { token: R, body: { option: 1 } });
  await call('POST', `/resident/polls/${poll.id}/vote`, { token: R, body: { option: 5 }, expect: [400], label: '/resident/polls/:id/vote（選項不存在）' });
  const rp = await call('GET', '/resident/polls', { token: R });
  check('一戶一票，可改票', rp[0].mine === 1 && rp[0].total === 1 && rp[0].counts[1] === 1, JSON.stringify(rp[0]));
  await call('PUT', `/polls/${poll.id}`, { token: M, cid, body: { title: '中庭要不要裝涼亭', options: ['要', '不要', '再議'], endDate: plus(7) }, expect: [400], label: '/polls/:id（已有作答不能改選項）' });
  await call('POST', '/polls', { token: M, cid, body: { title: '已截止', options: ['a', 'b'], endDate: plus(-1) } });
  const closed = (await call('GET', '/polls', { token: M, cid })).polls.find((x) => x.title === '已截止');
  await call('POST', `/resident/polls/${closed.id}/vote`, { token: R, body: { option: 0 }, expect: [400], label: '/resident/polls/:id/vote（已截止）' });

  // ── 財產清冊 ──
  await call('POST', '/assets', { token: M, cid, body: { assetNo: 'F-001', name: '滅火器', category: '消防', quantity: 12, cost: 9600, purchaseDate: today } });
  const assets = await call('GET', '/assets', { token: M, cid });
  await call('PUT', `/assets/${assets[0].id}`, { token: M, cid, body: { ...assets[0], purchaseDate: today, status: 'REPAIR' } });
  check('財產新增與修改', (await call('GET', '/assets', { token: M, cid }))[0].status === 'REPAIR');

  // ── 巡邏打卡 ──
  await call('POST', '/patrol/points', { token: M, cid, body: { name: '地下室 B1', seq: 1 } });
  const pt = (await call('GET', '/patrol', { token: M, cid })).points[0];
  const scan = await call('POST', '/patrol/scan', { token: M, body: { code: pt.code } });
  check('掃描巡邏點打卡', scan.point === '地下室 B1');
  await call('POST', '/patrol/scan', { token: M, body: { code: pt.code }, expect: [409], label: '/patrol/scan（一分鐘內重複）' });
  await call('POST', '/patrol/scan', { token: M, body: { code: 'nope' }, expect: [404], label: '/patrol/scan（不存在的巡邏點）' });
  const pl = await call('GET', '/patrol', { token: M, cid });
  check('巡邏紀錄', pl.logs.length === 1 && pl.logs[0].point.name === '地下室 B1');
  const delPt = await call('DELETE', `/patrol/points/${pt.id}`, { token: M, cid });
  check('有紀錄的巡邏點改為停用', delPt.deactivated === true);

  // ── 個資 ──
  await call('POST', '/resident/privacy', { token: R });
  check('住戶同意個資告知', !!(await call('GET', '/resident/me', { token: R })).privacyAt);
  await call('POST', '/export-log', { token: M, cid, body: { what: '戶別住戶', rows: 4 } });
  const logs = await call('GET', '/audit', { token: M, cid });
  check('匯出留下稽核紀錄', JSON.stringify(logs).includes('匯出資料'), JSON.stringify(logs).slice(0, 200));

  // ── 補齊的新增／編輯／刪除 ──
  const sfb = await call('POST', '/feedback', { token: M, cid, body: { unitId: U['A 2F-2'], category: '停車', title: '電話反映：車位被占' } });
  await call('PUT', `/feedback/${sfb.id}`, { token: M, cid, body: { category: '停車', title: '電話反映：B1 車位被占', content: '下午三點來電', reply: '', status: 'OPEN' } });
  check('管理端登錄並編輯意見', (await call('GET', '/feedback', { token: M, cid })).some((f) => f.id === sfb.id && f.title === '電話反映：B1 車位被占' && !f.residentId));
  await call('DELETE', `/feedback/${sfb.id}`, { token: M, cid });
  const fb2 = await call('POST', '/resident/feedback', { token: R, body: { title: '待修改' } });
  await call('PUT', `/resident/feedback/${fb2.id}`, { token: R, body: { category: '環境清潔', title: '垃圾間異味', content: '' } });
  check('住戶修改未回覆的意見', (await call('GET', '/resident/feedback', { token: R })).some((f) => f.id === fb2.id && f.title === '垃圾間異味'));
  await call('PUT', `/resident/feedback/${fb.id}`, { token: R, body: { title: 'x' }, expect: [400], label: '/resident/feedback/:id（已回覆不能修改）' });
  await call('POST', '/patrol/points', { token: M, cid, body: { name: '頂樓', seq: 2 } });
  const pt2 = (await call('GET', '/patrol', { token: M, cid })).points.find((p) => p.name === '頂樓');
  await call('POST', '/patrol/scan', { token: M, body: { code: pt2.code } });
  const log2 = (await call('GET', '/patrol', { token: M, cid })).logs.find((l) => l.pointId === pt2.id);
  await call('PUT', `/patrol/logs/${log2.id}`, { token: M, cid, body: { note: '水塔蓋已關' } });
  check('編輯巡邏紀錄備註', (await call('GET', '/patrol', { token: M, cid })).logs.find((l) => l.id === log2.id)?.note === '水塔蓋已關');
  await call('DELETE', `/patrol/logs/${log2.id}`, { token: M, cid });
  check('刪除誤掃的巡邏紀錄', !(await call('GET', '/patrol', { token: M, cid })).logs.some((l) => l.id === log2.id));

  // ── 銀行明細：國泰型（支出／存入兩欄、轉出帳號）、前面有說明列、虛擬帳號在備註 ──
  const cathay = `帳號：0123-456-789012\n查詢期間：${today} ~ ${today}\n交易日期,交易時間,摘要,支出金額,存入金額,餘額,轉出入帳號,備註\n${today.replace(/-/g, '/')},10:22,跨行轉入,,"2,300.00","1,000,000",00812345678901,繳費 ${va['A 2F-2']}\n${today.replace(/-/g, '/')},11:00,手續費,15,,"999,985",,\n小計,,,15,"2,300",,,`;
  const pv3 = await call('POST', '/bank/preview', { token: M, cid, body: { text: cathay } });
  check('國泰型明細：取存入欄、略過支出與小計、從備註比對虛擬帳號', pv3.rows?.length === 1 && pv3.rows[0].amount === 2300 && pv3.rows[0].unitLabel === 'A 2F-2' && pv3.rows[0].account === va['A 2F-2'], JSON.stringify(pv3.rows));
  const esun = `交易日期\t帳務日期\t交易說明\t提款\t存款\t餘額\t虛擬帳號\n${today}\t${today}\tATM 轉帳\t\t500\t100500\t${va['A 1F-2']}`;
  const pv4 = await call('POST', '/bank/preview', { token: M, cid, body: { text: esun } });
  check('玉山型明細（Tab 分隔、提款／存款欄）', pv4.rows?.length === 1 && pv4.rows[0].amount === 500 && pv4.rows[0].unitLabel === 'A 1F-2', JSON.stringify(pv4.rows));

  // ── 線上繳費（綠界測試環境；以測試金鑰模擬綠界通知）──
  const comm0 = await call('GET', '/community', { token: M, cid });
  check('社區資料不回傳金流金鑰', !('ecpayHashKey' in comm0) && !('ecpayHashIV' in comm0) && comm0.ecpayKeySet === false, Object.keys(comm0).join(','));
  let pi = await call('GET', '/resident/pay', { token: R });
  check('未開通時住戶看不到線上繳費', pi.enabled === false);
  await call('POST', '/resident/pay', { token: R, body: { method: 'Credit' }, expect: [400], label: '/resident/pay（未開通）' });
  await call('PUT', '/community', { token: A, cid, body: { onlinePay: true, ecpayStage: false }, expect: [400], label: '/community（正式環境未填金鑰）' });
  await call('PUT', '/community', { token: A, cid, body: { onlinePay: true, ecpayStage: true } });
  pi = await call('GET', '/resident/pay', { token: R });
  check('開通後住戶看到欠費與付款方式', pi.enabled === true && pi.amount > 0 && pi.methods.Credit === '信用卡', JSON.stringify(pi));
  const order = await call('POST', '/resident/pay', { token: R, body: { method: 'Credit' } });
  check('建立綠界訂單（測試環境網址、含檢查碼）', order.action?.includes('payment-stage.ecpay.com.tw') && order.fields?.TotalAmount === pi.amount && /^[0-9A-F]{64}$/.test(order.fields.CheckMacValue), JSON.stringify(order).slice(0, 200));
  const crypto = await import('crypto');
  const mac = (p) => {
    const body = Object.keys(p).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).map((k) => `${k}=${p[k]}`).join('&');
    const enc = encodeURIComponent(`HashKey=pwFHCqoQZGmho4w6&${body}&HashIV=EkRm7iFT261dpevs`).replace(/%20/g, '+').replace(/~/g, '%7e').replace(/'/g, '%27').toLowerCase();
    return crypto.createHash('sha256').update(enc).digest('hex').toUpperCase();
  };
  const notify = async (p) => { const r = await fetch(`${API}/pay/ecpay/notify`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(p).toString() }); return r.text(); };
  const base = { MerchantID: '3002607', MerchantTradeNo: order.fields.MerchantTradeNo, StoreID: '', RtnCode: '1', RtnMsg: '交易成功', TradeNo: '2510291234567890', TradeAmt: String(pi.amount), PaymentDate: `${today.replace(/-/g, '/')} 12:00:00`, PaymentType: 'Credit_CreditCard', PaymentTypeChargeFee: '30', TradeDate: `${today.replace(/-/g, '/')} 11:59:00`, SimulatePaid: '0' };
  const forged = { ...base, TradeAmt: '1' }; forged.CheckMacValue = mac(base);
  check('檢查碼不符的通知被拒絕', (await notify(forged)) !== '1|OK');
  const good = { ...base, CheckMacValue: mac(base) };
  check('付款通知回覆 1|OK', (await notify(good)) === '1|OK');
  check('重送同一通知仍回 1|OK', (await notify(good)) === '1|OK');
  const after = await call('GET', '/resident/pay', { token: R });
  check('線上付款後自動銷帳', after.amount === 0, JSON.stringify(after));
  const ops = await call('GET', '/online-payments', { token: M, cid });
  const op = ops.find((o) => o.tradeNo === order.fields.MerchantTradeNo);
  check('線上繳費紀錄已入帳且只入帳一次', op?.status === 'PAID' && op.receiptNos.split(',').length >= 1, JSON.stringify(op));
  const todayPays = await call('GET', `/payments?from=${today}&to=${today}`, { token: M, cid });
  check('收款紀錄為信用卡、不重複', todayPays.filter((p) => p.note.includes('2510291234567890') && !p.voided).length === op.receiptNos.split(',').length && todayPays.some((p) => p.method === 'CARD'), JSON.stringify(todayPays.map((p) => [p.method, p.note])));
  await call('DELETE', `/online-payments/${op.id}`, { token: M, cid, expect: [400], label: '/online-payments/:id（已付款不能刪）' });
  await call('POST', '/resident/pay', { token: R, body: { method: 'ATM' }, expect: [400], label: '/resident/pay（沒有欠費）' });
  await call('PUT', '/community', { token: A, cid, body: { onlinePay: false } });

  // ── LINE 狀態 ──
  const ls = await call('GET', '/line/status', { token: M, cid });
  check('LINE 狀態：顯示 webhook 網址與綁定人數', typeof ls.enabled === 'boolean' && ls.webhookUrl.endsWith('/api/line/webhook') && ls.residents >= 1, JSON.stringify(ls));
  if (!ls.enabled) await call('POST', '/line/test', { token: M, cid, expect: [400], label: '/line/test（未設定憑證時說明原因）' });

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

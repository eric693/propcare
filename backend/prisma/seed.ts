// 示範資料：兩個虛構社區、半年帳務、包裹、預約、報修、區權會。人名與電話皆為虛構。
// 用法：npx ts-node prisma/seed.ts          （已有社區時不動作）
//       npx ts-node prisma/seed.ts --reset  （刪除示範社區後重建；不影響其他社區）
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { generateBills, recordPayment } from '../src/services/feeService';
import { DEFAULT_INSPECTIONS } from '../src/controllers/communityController';
import { nextDocNo } from '../src/services/common';
import { addDays, addMonths, toDate, todayStr } from '../src/utils/dates';

const prisma = new PrismaClient();
const DEMO_NAMES = ['晴空雅苑（示範）', '河岸花園（示範）'];
const SURNAMES = '陳林黃張李王吳劉蔡楊許鄭謝郭洪曾邱廖賴周'.split('');
const GIVEN = ['志明', '淑芬', '家豪', '雅婷', '俊傑', '怡君', '建宏', '美玲', '冠宇', '佩珊', '宗翰', '欣怡', '承恩', '詩涵'];
let seq = 1;
const fakePhone = () => `0912${String(seq++).padStart(6, '0')}`;
const pick = <T,>(a: T[], i: number) => a[i % a.length];

async function wipeDemo() {
  const cs = await prisma.community.findMany({ where: { name: { in: DEMO_NAMES } } });
  for (const c of cs) {
    const id = c.id;
    await prisma.poll.deleteMany({ where: { communityId: id } });
    await prisma.patrolLog.deleteMany({ where: { communityId: id } });
    for (const m of ['patrolPoint', 'bankTxn', 'dunning', 'visitor', 'feedback', 'document', 'asset'] as const) await (prisma[m] as unknown as { deleteMany: (a: object) => Promise<unknown> }).deleteMany({ where: { communityId: id } });
    await prisma.motionVote.deleteMany({ where: { motion: { meeting: { communityId: id } } } });
    await prisma.meetingAttendance.deleteMany({ where: { meeting: { communityId: id } } });
    await prisma.meeting.deleteMany({ where: { communityId: id } });
    await prisma.ledgerEntry.deleteMany({ where: { communityId: id } });
    await prisma.feePayment.deleteMany({ where: { communityId: id } });
    await prisma.feeBill.deleteMany({ where: { communityId: id } });
    await prisma.package.deleteMany({ where: { communityId: id } });
    await prisma.booking.deleteMany({ where: { communityId: id } });
    await prisma.facility.deleteMany({ where: { communityId: id } });
    await prisma.repair.deleteMany({ where: { communityId: id } });
    await prisma.announcement.deleteMany({ where: { communityId: id } });
    await prisma.inspection.deleteMany({ where: { communityId: id } });
    await prisma.contract.deleteMany({ where: { communityId: id } });
    await prisma.vendor.deleteMany({ where: { communityId: id } });
    await prisma.parkingSpace.deleteMany({ where: { communityId: id } });
    await prisma.resident.deleteMany({ where: { communityId: id } });
    await prisma.unit.deleteMany({ where: { communityId: id } });
    await prisma.userCommunity.deleteMany({ where: { communityId: id } });
    await prisma.auditLog.deleteMany({ where: { communityId: id } });
    await prisma.community.delete({ where: { id } });
  }
}

async function seedCommunity(opts: { name: string; address: string; buildings: string[]; floors: number; perFloor: number; rate: number; reserve: number; vaPrefix: string }) {
  const t = todayStr();
  const c = await prisma.community.create({
    data: {
      name: opts.name, address: opts.address, phone: '02-2700-0000', feeMode: 'AREA', feeRate: opts.rate, reserveRatio: opts.reserve,
      dueDay: 15, autoBillDay: 0, bankInfo: '示範銀行 012 帳號 0000-0000-0000（戶名：○○社區管理委員會）',
      openingMgmt: 380000, openingReserve: 2600000, openingDate: addMonths(t, -6).slice(0, 7) + '-01',
    },
  });
  // 戶別與住戶
  let n = 0;
  const units = [];
  for (const b of opts.buildings) for (let f = 2; f <= opts.floors + 1; f++) for (let k = 1; k <= opts.perFloor; k++) {
    const area = [28.6, 34.2, 41.5, 52.8][(k - 1) % 4];
    const sur = pick(SURNAMES, n * 7 + 3), given = pick(GIVEN, n * 5 + 1);
    const u = await prisma.unit.create({
      data: {
        communityId: c.id, building: b, floor: `${f}F`, no: String(k), label: `${b}棟 ${f}F-${k}`, area, share: Math.round(area * 100) / 100,
        occupancy: n % 9 === 4 ? 'RENT' : n % 23 === 7 ? 'VACANT' : 'SELF', ownerName: `${sur}${given}`,
      },
    });
    units.push(u);
    if (u.occupancy !== 'VACANT') {
      const phone = fakePhone();
      await prisma.resident.create({
        data: { communityId: c.id, unitId: u.id, name: `${sur}${given}`, phone, relation: u.occupancy === 'RENT' ? 'TENANT' : 'OWNER', password: await bcrypt.hash(phone.slice(-6), 6), mustChangePassword: phone !== '0912000001' },
      });
    }
    n++;
  }
  // 車位
  for (let i = 0; i < Math.floor(units.length * 0.6); i++) {
    await prisma.parkingSpace.create({ data: { communityId: c.id, code: `B${i % 2 + 1}-${String(i + 1).padStart(3, '0')}`, kind: i % 5 === 4 ? 'MOTO' : 'CAR', unitId: units[(i * 3) % units.length].id, monthlyFee: i % 5 === 4 ? 100 : 500 } });
  }
  // 近 6 期帳單與收款：大多準時繳，少數拖欠
  for (let m = 5; m >= 0; m--) {
    const period = addMonths(t, -m).slice(0, 7);
    await generateBills(c.id, period);
    const bills = await prisma.feeBill.findMany({ where: { communityId: c.id, period }, include: { unit: true } });
    for (const [i, b] of bills.entries()) {
      const chronic = i % 17 === 3;                      // 長期欠繳
      const late = i % 11 === 5 && m <= 1;                // 最近兩期未繳
      const current = m === 0 && i % 8 === 0;            // 本期還沒繳
      if (chronic && m <= 3) continue;
      if (late || current) continue;
      const paidDate = addDays(`${period}-01`, 3 + (i % 14));
      if (paidDate > t) continue;
      await recordPayment({ communityId: c.id, billId: b.id, amount: i % 29 === 9 ? Math.round(b.total / 2) : b.total, method: (['TRANSFER', 'CASH', 'ATM'] as const)[i % 3], paidDate, by: '示範資料' });
    }
  }
  // 廠商、合約、支出
  const vendors = await Promise.all([
    ['潔淨物業清潔', '清潔', 68000], ['安心保全', '保全', 120000], ['永昇電梯', '電梯', 9800], ['祥和消防', '消防', 4500], ['綠意園藝', '園藝', 6000],
  ].map(([name, kind]) => prisma.vendor.create({ data: { communityId: c.id, name: String(name), kind: String(kind), contact: '王經理', phone: '02-2700-1234' } })));
  const scale = units.length / 96;                     // 廠商費用依社區規模
  const fees = [68000, 120000, 9800, 4500, 6000].map((f) => Math.round(f * scale / 100) * 100);
  for (const [i, v] of vendors.entries()) {
    await prisma.contract.create({ data: { communityId: c.id, vendorId: v.id, title: `${v.kind}服務合約`, kind: v.kind, monthlyAmount: fees[i], startDate: toDate(addMonths(t, -10)), endDate: toDate(addMonths(t, i === 2 ? 1 : 14 - i)), notifyDays: 60 } });
  }
  for (let m = 5; m >= 0; m--) {
    const d = addMonths(t, -m).slice(0, 7);
    for (const [i, v] of vendors.entries()) {
      const date = `${d}-05`;
      if (date > t) continue;
      await prisma.ledgerEntry.create({ data: { communityId: c.id, date: toDate(date), fund: 'MGMT', direction: 'OUT', category: ['清潔費', '保全費', '電梯保養', '消防保養', '園藝綠化'][i], amount: fees[i], description: `${d} ${v.name}`, vendorId: v.id, approval: 'APPROVED', approvedBy: '主任委員', createdBy: '示範資料' } });
    }
    const date = `${d}-20`;
    if (date <= t) await prisma.ledgerEntry.create({ data: { communityId: c.id, date: toDate(date), fund: 'MGMT', direction: 'OUT', category: '水電費', amount: Math.round((31000 + m * 1300) * scale), description: '公共用電、用水', approval: 'APPROVED', approvedBy: '主任委員', createdBy: '示範資料' } });
  }
  await prisma.ledgerEntry.create({ data: { communityId: c.id, date: toDate(addMonths(t, -2)), fund: 'RESERVE', direction: 'OUT', category: '修繕工程', amount: 186000, description: '頂樓防水層翻修（區權會決議動支公共基金）', approval: 'APPROVED', approvedBy: '主任委員', createdBy: '示範資料' } });
  await prisma.ledgerEntry.create({ data: { communityId: c.id, date: toDate(t), fund: 'MGMT', direction: 'OUT', category: '機電維修', amount: 12800, description: '地下室排水馬達更換', approval: 'PENDING', createdBy: '示範資料' } });

  // 包裹
  const carriers = ['黑貓宅急便', '新竹物流', '郵局', '嘉里大榮', '蝦皮店到家'];
  for (let i = 0; i < 18; i++) {
    const u = units[(i * 7) % units.length];
    const old = i < 3;
    await prisma.package.create({
      data: {
        communityId: c.id, unitId: u.id, carrier: pick(carriers, i), trackingNo: `TW${900000 + i * 37}`, kind: i % 6 === 5 ? 'COLD' : i % 4 === 3 ? 'REGISTERED' : 'PARCEL',
        shelf: `${String.fromCharCode(65 + (i % 4))}-${i % 5 + 1}`, pickupCode: String(2000 + i * 13), receivedBy: '櫃台',
        receivedAt: new Date(Date.now() - (old ? 9 + i : i % 3) * 86400000 - i * 3600000),
        status: i > 13 ? 'PICKED' : 'WAITING', pickedAt: i > 13 ? new Date() : null,
      },
    });
  }
  // 公設與預約
  const gym = await prisma.facility.create({ data: { communityId: c.id, name: '健身房', openTime: '06:00', closeTime: '23:00', slotMinutes: 60, capacity: 6, maxPerWeek: 7, advanceDays: 7, rules: '請穿運動鞋，使用後器材歸位擦拭。' } });
  const ktv = await prisma.facility.create({ data: { communityId: c.id, name: 'KTV 視聽室', openTime: '10:00', closeTime: '22:00', slotMinutes: 120, capacity: 1, maxPerWeek: 2, advanceDays: 14, fee: 200, rules: '每次 2 小時，音量請勿影響鄰居，22:00 準時結束。' } });
  await prisma.facility.create({ data: { communityId: c.id, name: '交誼廳（宴會用）', openTime: '09:00', closeTime: '21:00', slotMinutes: 240, capacity: 1, maxPerWeek: 1, advanceDays: 30, fee: 500, rules: '使用後請恢復原狀，垃圾自行帶走。' } });
  for (let i = 0; i < 6; i++) {
    await prisma.booking.create({ data: { communityId: c.id, facilityId: i % 2 ? ktv.id : gym.id, unitId: units[(i * 11) % units.length].id, date: toDate(addDays(t, i % 4)), startTime: i % 2 ? ['10:00', '14:00', '18:00'][i % 3] : `${String(18 + (i % 3)).padStart(2, '0')}:00`, endTime: i % 2 ? ['12:00', '16:00', '20:00'][i % 3] : `${String(19 + (i % 3)).padStart(2, '0')}:00`, createdBy: '示範資料' } });
  }
  // 報修
  const reps: [string, string, string, 'URGENT' | 'HIGH' | 'NORMAL', 'NEW' | 'ASSIGNED' | 'WORKING' | 'DONE'][] = [
    ['電梯', 'B 棟電梯', '電梯門關閉時異音', 'HIGH', 'ASSIGNED'],
    ['漏水', '地下二樓車道', '天花板滲水', 'URGENT', 'WORKING'],
    ['照明', 'A 棟 7F 梯廳', '走道燈不亮', 'NORMAL', 'NEW'],
    ['門禁對講', '大門', '感應扣偶爾無法開門', 'NORMAL', 'NEW'],
    ['公設損壞', '健身房', '跑步機皮帶打滑', 'NORMAL', 'DONE'],
  ];
  for (const [i, [cat, loc, title, pr, st]] of reps.entries()) {
    const unit = units[(i * 13) % units.length];
    const r = await prisma.repair.create({ data: { communityId: c.id, repairNo: await nextDocNo('R'), unitId: i % 2 ? unit.id : null, category: cat, location: loc, title, priority: pr, status: st, createdAt: new Date(Date.now() - (i + 1) * 86400000), assignee: st !== 'NEW' ? '永昇電梯 李師傅' : '' } });
    await prisma.repairLog.create({ data: { repairId: r.id, byName: '管理中心', text: i % 2 ? '住戶線上報修' : '管理中心登記報修' } });
    if (st !== 'NEW') await prisma.repairLog.create({ data: { repairId: r.id, byName: '管理中心', text: '已聯絡廠商，預計明日到場' } });
  }
  // 公告
  const anns = [
    ['停水通知', '因自來水公司管線工程，本週六 09:00～15:00 全社區停水，請提前儲水。', '停水停電', true],
    ['年度消防安全設備檢修', '消防設備師將於下週二至週三進行各戶警報器檢查，請配合開門。', '一般', false],
    ['區分所有權人會議會議紀錄公告', '本年度區分所有權人會議紀錄已上傳至住戶專區「會議」頁，請各住戶參閱。', '會議', false],
    ['資源回收時間調整', '即日起資源回收改為每週二、五晚上 19:00～21:00。', '一般', false],
  ] as const;
  for (const [i, [title, body, cat, pin]] of anns.entries()) {
    await prisma.announcement.create({ data: { communityId: c.id, title, body, category: cat, pinned: pin, publishDate: toDate(addDays(t, -i * 4)), createdBy: '總幹事' } });
  }
  // 法定檢查
  for (const [i, d] of DEFAULT_INSPECTIONS.entries()) {
    await prisma.inspection.create({ data: { communityId: c.id, kind: d.kind, title: d.title, cycleMonths: d.cycle, note: d.note, vendorId: d.kind === '電梯' ? vendors[2].id : d.kind === '消防' ? vendors[3].id : null, dueDate: toDate(addDays(t, [20, 150, 45, 9, 200, 35, 90][i])) } });
  }
  // 已召開的區權會：出席 70%，議案一通過、一未過
  const meeting = await prisma.meeting.create({
    data: {
      communityId: c.id, kind: 'OWNERS', title: `${t.slice(0, 4)} 年度區分所有權人會議`, meetingDate: toDate(addDays(t, -40)), noticeDate: toDate(addDays(t, -55)),
      location: '社區交誼廳', status: 'HELD', agenda: '一、管委會工作報告\n二、財務報告\n三、討論提案', minutes: '主席宣布出席戶數及區分所有權比例均達法定人數，開會。\n（以下略）',
    },
  });
  const attend = units.filter((_, i) => i % 10 < 7);
  await prisma.meetingAttendance.createMany({ data: attend.map((u, i) => ({ meetingId: meeting.id, unitId: u.id, proxy: i % 6 === 2 ? '鄰居代理' : '' })) });
  const m1 = await prisma.motion.create({ data: { meetingId: meeting.id, seq: 1, title: '動支公共基金翻修頂樓防水層', description: '預算 18.6 萬元' } });
  const m2 = await prisma.motion.create({ data: { meetingId: meeting.id, seq: 2, title: '管理費每坪調漲 5 元', description: '因保全、清潔人力成本上升' } });
  await prisma.motionVote.createMany({ data: attend.map((u, i) => ({ motionId: m1.id, unitId: u.id, vote: i % 9 === 0 ? 'NO' as const : 'YES' as const })) });
  await prisma.motionVote.createMany({ data: attend.map((u, i) => ({ motionId: m2.id, unitId: u.id, vote: i % 3 === 0 ? 'NO' as const : i % 7 === 0 ? 'ABSTAIN' as const : 'YES' as const })) });
  await prisma.meeting.create({ data: { communityId: c.id, kind: 'COMMITTEE', title: '管理委員會例會', meetingDate: toDate(addDays(t, 12)), location: '管理中心會議室', agenda: '一、本月財務報告\n二、電梯保養合約續約\n三、地下室漏水處理', status: 'PLANNED' } });
  await prisma.meeting.update({ where: { id: meeting.id }, data: { minutesSentDate: toDate(addDays(t, -30)) } });

  const residents = await prisma.resident.findMany({ where: { communityId: c.id }, orderBy: { createdAt: 'asc' } });
  // 虛擬帳號：前綴＋序號共 14 碼
  const prefix = opts.vaPrefix;
  await prisma.community.update({ where: { id: c.id }, data: { vaBank: '示範銀行 012', vaPrefix: prefix } });
  for (const [i, u] of units.entries()) await prisma.unit.update({ where: { id: u.id }, data: { vaCode: prefix + String(i + 1).padStart(14 - prefix.length, '0') } });

  // 催告送達紀錄：欠最多期的前 3 戶
  const owing = await prisma.feeBill.groupBy({ by: ['unitId'], where: { communityId: c.id, status: { in: ['UNPAID', 'PARTIAL'] } }, _count: true, _sum: { total: true, paid: true }, orderBy: { _count: { unitId: 'desc' } }, take: 3 });
  for (const [i, o] of owing.entries()) {
    await prisma.dunning.create({ data: { communityId: c.id, unitId: o.unitId, date: toDate(addDays(t, -10 - i * 3)), method: i === 0 ? '存證信函' : '雙掛號', trackingNo: `${i === 0 ? 'TP' : 'RR'}${String(482019 + i * 37)}`, amount: (o._sum.total ?? 0) - (o._sum.paid ?? 0), deliveredDate: i < 2 ? toDate(addDays(t, -8 - i * 3)) : null, receivedBy: i < 2 ? '本人' : '', createdBy: '總幹事' } });
  }

  // 訪客：今天在場 2 組，過去幾天的紀錄
  const visitors = [['陳先生', '拜訪', 2, 'BXK-2231', 0], ['foodpanda 外送', '外送', 1, '', 0], ['李小姐', '看屋', 1, '', 1], ['冷氣保養 張師傅', '廠商施工', 2, 'AQC-8890', 1], ['王太太', '拜訪', 3, 'RDE-5521', 2], ['林先生', '拜訪', 1, '', 3]] as const;
  for (const [i, [name, purpose, headcount, plate, daysAgo]] of visitors.entries()) {
    const inAt = new Date(Date.now() - daysAgo * 86400000 - (i + 1) * 40 * 60000);
    await prisma.visitor.create({ data: { communityId: c.id, unitId: units[(i * 7) % units.length].id, name, purpose, headcount, plate, badge: plate ? `訪-${10 + i}` : '', inAt, outAt: daysAgo === 0 ? null : new Date(inAt.getTime() + 90 * 60000), createdBy: '保全 陳大哥' } });
  }
  // 寄放物品
  await prisma.package.create({ data: { communityId: c.id, unitId: units[3].id, kind: 'DEPOSIT', depositor: residents[3]?.name ?? '', recipient: '表弟 小周', shelf: '寄放櫃', pickupCode: String(700000 + units.length), receivedBy: '總幹事', note: '鑰匙一串' } });

  // 住戶意見
  const fbs = [['噪音', '樓上深夜拖拉桌椅', '最近一週晚上 12 點後常有拖拉聲，麻煩協助宣導。', ''], ['停車', '訪客車位被長期占用', 'B1 訪客車位有同一台車停了三天。', '已張貼移車通知，並請保全加強巡查，謝謝反映。'], ['建議', '希望增設電動車充電樁', '', '']] as const;
  for (const [i, [category, title, content, reply]] of fbs.entries()) {
    const r = residents[(i * 11) % residents.length];
    await prisma.feedback.create({ data: { communityId: c.id, unitId: r.unitId, residentId: r.id, category, title, content, reply, status: reply ? 'REPLIED' : 'OPEN', repliedBy: reply ? '總幹事' : '', repliedAt: reply ? new Date() : null, createdAt: new Date(Date.now() - (i + 1) * 86400000) } });
  }

  // 意見調查（進行中，約三成住戶作答）
  const poll = await prisma.poll.create({ data: { communityId: c.id, title: '中庭是否增設兒童遊戲區', description: '預估經費約 25 萬元，由公共基金支應；若多數贊成將提區權會決議。', options: ['贊成', '反對', '沒意見'], endDate: toDate(addDays(t, 10)), createdBy: '總幹事' } });
  await prisma.pollVote.createMany({ data: units.filter((_, i) => i % 3 === 0).map((u, i) => ({ pollId: poll.id, unitId: u.id, option: i % 5 === 0 ? 1 : i % 7 === 0 ? 2 : 0 })) });

  // 財產清冊
  const assets = [['F-001', '滅火器（10 型）', '消防', '各樓梯廳', 24, 19200, 'IN_USE'], ['S-001', '監視系統主機與攝影機', '監視門禁', '管理中心', 1, 186000, 'IN_USE'], ['G-001', '跑步機', '健身器材', '健身房', 2, 96000, 'REPAIR'], ['M-001', '地下室排水馬達', '機電', 'B2 機房', 2, 64000, 'IN_USE'], ['O-001', '管理中心電腦', '電腦文具', '管理中心', 1, 28000, 'IN_USE']] as const;
  for (const [assetNo, name, category, location, quantity, cost, status] of assets) {
    await prisma.asset.create({ data: { communityId: c.id, assetNo, name, category, location, quantity, cost, status, purchaseDate: toDate(addMonths(t, -30)), keeper: '總幹事' } });
  }

  // 巡邏點與今日紀錄
  const pts = [];
  for (const [i, [name, location]] of [['大門警衛室', '1F'], ['地下室 B1 車道', 'B1'], ['地下室 B2 機房', 'B2'], ['頂樓水塔', 'RF'], ['中庭', '1F']].entries()) {
    pts.push(await prisma.patrolPoint.create({ data: { communityId: c.id, name, location, seq: i + 1, code: `demo${c.id.slice(-6)}${i}` } }));
  }
  for (const [i, p] of pts.slice(0, 4).entries()) {
    await prisma.patrolLog.create({ data: { communityId: c.id, pointId: p.id, userName: '保全 陳大哥', note: i === 2 ? '排水馬達運轉正常' : '', scannedAt: new Date(Date.now() - (5 - i) * 15 * 60000) } });
  }
  return c;
}

async function main() {
  const reset = process.argv.includes('--reset');
  if (reset) await wipeDemo();
  else if (await prisma.community.count()) { console.log('已有社區資料，略過（要重建示範資料請加 --reset）'); return; }

  const c1 = await seedCommunity({ name: DEMO_NAMES[0], address: '台北市信義區示範路 100 號', buildings: ['A', 'B'], floors: 12, perFloor: 4, rate: 80, reserve: 10, vaPrefix: '8001' });
  const c2 = await seedCommunity({ name: DEMO_NAMES[1], address: '新北市板橋區河岸街 8 號', buildings: ['C'], floors: 10, perFloor: 4, rate: 65, reserve: 15, vaPrefix: '8002' });

  // 帳號：示範帳號（總幹事，管兩個示範社區）、示範委員；管理員帳號只在第一次建立
  const demo = process.env.DEMO_ACCOUNT?.trim().toLowerCase();
  if (demo && process.env.DEMO_PASSWORD) {
    const u = await prisma.user.upsert({
      where: { username: demo }, update: {},
      create: { username: demo, password: await bcrypt.hash(process.env.DEMO_PASSWORD, 10), name: '示範總幹事', role: 'MANAGER', title: '總幹事' },
    });
    await prisma.userCommunity.createMany({ data: [c1, c2].map((c) => ({ userId: u.id, communityId: c.id })), skipDuplicates: true });
  }
  const committee = await prisma.user.upsert({
    where: { username: 'committee' }, update: {},
    create: { username: 'committee', password: await bcrypt.hash('committee1234', 10), name: '示範主委', role: 'COMMITTEE', title: '主任委員' },
  });
  await prisma.userCommunity.createMany({ data: [{ userId: committee.id, communityId: c1.id }], skipDuplicates: true });
  if (!(await prisma.user.findFirst({ where: { role: 'ADMIN' } }))) {
    const pw = process.env.ADMIN_PASSWORD || Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8);
    await prisma.user.create({ data: { username: 'admin', password: await bcrypt.hash(pw, 10), name: '物業公司管理員', role: 'ADMIN', title: '管理員' } });
    console.log(`管理員帳號 admin，密碼：${pw}（請登入後立即修改）`);
  }
  console.log('示範資料建立完成');
}

main().finally(() => prisma.$disconnect());

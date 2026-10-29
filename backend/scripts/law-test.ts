// 法規計算單元測試（不需資料庫）：npx ts-node --transpile-only scripts/law-test.ts
import { Community } from '@prisma/client';
import { finalityOf, minutesCheck, motionOf, quorumOf } from '../src/services/meetingService';
import { checkMacValue, verifyMac } from '../src/services/ecpay';

let fail = 0;
const check = (label: string, cond: boolean, detail: unknown = '') => { console.log(`${cond ? '✓' : '✗'} ${label}${cond ? '' : ' → ' + JSON.stringify(detail)}`); if (!cond) fail++; };
const c = { quorumAttend: 0.6667, quorumPass: 0.75, quorumReAttend: 0.2, quorumRePass: 0.5 } as Community;
const d = (s: string) => new Date(`${s}T00:00:00Z`);

// 10 戶、比例各 10；建商持有 4 戶（40%）→ 第 27 條：超過 1/5（2 戶、20%）不計
const units = Array.from({ length: 10 }, (_, i) => ({ id: `u${i}`, share: 10, ownerName: i < 4 ? '建設公司' : `住戶${i}` }));
const all = new Map(units.map((u) => [u.id, '']));
let q = quorumOf(c, { kind: 'OWNERS', reconvene: false }, units, all);
check('建商 4 戶只計 2 戶、比例 20', Math.abs(q.attendUnits - 8) < 1e-9 && Math.abs(q.attendShare - 80) < 1e-9, q);
check('列出超過 1/5 的所有權人', q.capped.length === 1 && q.capped[0].name === '建設公司' && q.capped[0].countedUnits === 2, q.capped);

// 建商 4 戶 + 住戶 3 戶出席：未折算 70% 會過 2/3；折算後 (2+3)/10 = 50% → 未達定額
const seven = new Map(units.slice(0, 7).map((u) => [u.id, '']));
q = quorumOf(c, { kind: 'OWNERS', reconvene: false }, units, seven);
check('建商超額不計後未達 2/3 定額', q.met === false && Math.abs(q.attendRate - 0.5) < 1e-9, q);

// 受託人代理 3 戶（住戶4～6）→ 只計 2 戶
const proxy = new Map(units.map((u, i) => [u.id, i >= 4 && i <= 6 ? '王代理' : '']));
q = quorumOf(c, { kind: 'OWNERS', reconvene: false }, units, proxy);
check('受託人超過 1/5 的部分不計', q.capped.some((x) => x.kind === '受託人' && x.name === '王代理' && x.countedUnits === 2), q.capped);

// 表決同樣折算：全部出席，建商 4 票 + 住戶 3 票同意（共 7 / 10 戶）
q = quorumOf(c, { kind: 'OWNERS', reconvene: false }, units, all);
const votes = new Map(units.slice(0, 7).map((u) => [u.id, 'YES']));
const r = motionOf(c, { reconvene: false }, q, units, votes);
check('同意票也依上限折算：(2+3)/8 = 62.5% 未達 3/4', r.passed === false && Math.abs(r.yesRate - 0.625) < 1e-9, r);

// 4 戶的小社區不適用 1/5（否則永遠達不到定額）
const small = units.slice(0, 4).map((u) => ({ ...u, ownerName: '同一人' }));
q = quorumOf(c, { kind: 'OWNERS', reconvene: false }, small, new Map(small.map((u) => [u.id, ''])));
check('不足 5 戶不套用 1/5 上限', q.capped.length === 0 && q.met, q);

// 第 32 條異議程序
const m = { reconvene: true, meetingDate: d('2026-10-01'), minutesSentDate: null as Date | null };
check('未送達決議 → 待送達（10 日內）', finalityOf(m, true, units, [], '2026-10-05')?.status === 'NEED_NOTICE');
m.minutesSentDate = d('2026-10-05');
check('送達後 7 日內 → 異議期中', finalityOf(m, true, units, [], '2026-10-12')?.status === 'OBJECTION_PERIOD');
check('異議期滿、反對未過半 → 成立', finalityOf(m, true, units, ['u0', 'u1'], '2026-10-13')?.status === 'FINAL');
check('反對人數與比例都過半 → 不成立', finalityOf(m, true, units, ['u0', 'u1', 'u2', 'u3', 'u4', 'u5'], '2026-10-13')?.status === 'OBJECTED');
check('反對剛好一半 → 仍成立', finalityOf(m, true, units, ['u0', 'u1', 'u2', 'u3', 'u4'], '2026-10-13')?.status === 'FINAL');
check('一般會議（非重新召集）沒有異議程序', finalityOf({ ...m, reconvene: false }, true, units, []) === null);

// 第 34 條會議紀錄期限
const held = { kind: 'OWNERS' as const, status: 'HELD' as const, reconvene: false, meetingDate: d('2026-10-01'), minutesSentDate: null as Date | null };
check('會後 15 日內須送達會議紀錄', minutesCheck(held, '2026-10-10')?.deadline === '2026-10-16' && minutesCheck(held, '2026-10-10')?.ok === false);
check('準時送達 → 符合', minutesCheck({ ...held, minutesSentDate: d('2026-10-15') })?.ok === true);
check('逾期送達 → 標示逾期', minutesCheck({ ...held, minutesSentDate: d('2026-10-20') })?.ok === false);

// 綠界檢查碼：官方文件範例（https://developers.ecpay.com.tw/2902/）
const ex = { ChoosePayment: 'ALL', EncryptType: 1, ItemName: 'Apple iphone 15', MerchantID: '3002607', MerchantTradeDate: '2023/03/12 15:30:23', MerchantTradeNo: 'ecpay20230312153023', PaymentType: 'aio', ReturnURL: 'https://www.ecpay.com.tw/receive.php', TotalAmount: 30000, TradeDesc: '促銷方案' };
const mac = checkMacValue(ex, 'pwFHCqoQZGmho4w6', 'EkRm7iFT261dpevs');
check('綠界檢查碼與官方範例一致', mac === '6C51C9E6888DE861FD62FB1DD17029FC742634498FD813DC43D4243B5685B840', mac);
const signed = Object.fromEntries(Object.entries({ ...ex, CheckMacValue: mac }).map(([k, v]) => [k, String(v)]));
check('驗證通知檢查碼：正確通過、竄改金額失敗', verifyMac(signed, { hashKey: 'pwFHCqoQZGmho4w6', hashIV: 'EkRm7iFT261dpevs' }) && !verifyMac({ ...signed, TotalAmount: '1' }, { hashKey: 'pwFHCqoQZGmho4w6', hashIV: 'EkRm7iFT261dpevs' }));

console.log(fail ? `\n${fail} 項失敗` : '\n全部通過');
process.exit(fail ? 1 : 0);

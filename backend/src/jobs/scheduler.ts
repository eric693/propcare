import cron from 'node-cron';
import { prisma } from '../prisma';
import { generateBills } from '../services/feeService';
import { notifyStaff, notifyUnit } from '../services/lineService';
import { addDays, dateStr, toDate, todayStr } from '../utils/dates';

// 每日排程（台北時間）：
// 08:00 自動開立當月帳單（社區設定的開帳日）、繳費期限前提醒
// 09:00 包裹逾期未領提醒、合約與法定申報到期提醒（每週一彙整給負責員工）

export async function runBilling(today = todayStr()) {
  const day = Number(today.slice(8, 10));
  const period = today.slice(0, 7);
  const out: string[] = [];
  for (const c of await prisma.community.findMany({ where: { active: true } })) {
    if (c.autoBillDay > 0 && c.autoBillDay === day) {
      const r = await generateBills(c.id, period);
      if (r.created) {
        out.push(`${c.name} 開立 ${period} 帳單 ${r.created} 張`);
        const bills = await prisma.feeBill.findMany({ where: { communityId: c.id, period } });
        for (const b of bills) {
          await notifyUnit(b.unitId, `【${c.name}】${period} 管理費帳單已開立\n應繳 ${b.total.toLocaleString()} 元，繳費期限 ${dateStr(b.dueDate)}${c.bankInfo ? `\n繳費帳戶：${c.bankInfo}` : ''}`);
        }
      }
    }
    if (c.remindDaysBefore > 0) {
      const target = toDate(addDays(today, c.remindDaysBefore));
      const due = await prisma.feeBill.findMany({
        where: { communityId: c.id, status: { in: ['UNPAID', 'PARTIAL'] }, dueDate: target, remindedAt: null },
      });
      for (const b of due) {
        await notifyUnit(b.unitId, `【${c.name}】提醒您 ${b.period} 管理費 ${(b.total - b.paid).toLocaleString()} 元將於 ${dateStr(b.dueDate)} 到期，已繳請忽略。`);
        await prisma.feeBill.update({ where: { id: b.id }, data: { remindedAt: new Date() } });
      }
      if (due.length) out.push(`${c.name} 繳費提醒 ${due.length} 戶`);
    }
  }
  return out;
}

export async function runDailyNotices(today = todayStr()) {
  const out: string[] = [];
  const isMonday = new Date(`${today}T00:00:00Z`).getUTCDay() === 1;
  for (const c of await prisma.community.findMany({ where: { active: true } })) {
    const cutoff = new Date(Date.now() - c.packageOverdueDays * 86400000);
    const pkgs = await prisma.package.findMany({ where: { communityId: c.id, status: 'WAITING', receivedAt: { lt: cutoff } } });
    const byUnit = new Map<string, number>();
    for (const p of pkgs) byUnit.set(p.unitId, (byUnit.get(p.unitId) ?? 0) + 1);
    for (const [unitId, n] of byUnit) await notifyUnit(unitId, `【${c.name}】管理中心有您 ${n} 件包裹已代收超過 ${c.packageOverdueDays} 天，請盡快領取。`);
    if (byUnit.size) out.push(`${c.name} 包裹逾期提醒 ${byUnit.size} 戶`);

    if (isMonday) {
      const in60 = toDate(addDays(today, 60));
      const inspections = await prisma.inspection.findMany({ where: { communityId: c.id, status: 'PENDING', dueDate: { lte: in60 } }, orderBy: { dueDate: 'asc' } });
      const contracts = (await prisma.contract.findMany({ where: { communityId: c.id, active: true, endDate: { not: null } } }))
        .filter((k) => k.endDate! <= toDate(addDays(today, k.notifyDays)));
      if (inspections.length || contracts.length) {
        const lines = [
          ...inspections.map((i) => `・${i.title} 期限 ${dateStr(i.dueDate)}`),
          ...contracts.map((k) => `・合約「${k.title}」${dateStr(k.endDate)} 到期`),
        ];
        await notifyStaff(c.id, `【${c.name}】近期到期事項\n${lines.join('\n')}`);
        out.push(`${c.name} 到期事項 ${lines.length} 項`);
      }
    }
  }
  return out;
}

export function startScheduler() {
  const opts = { timezone: 'Asia/Taipei' };
  cron.schedule('0 8 * * *', () => { runBilling().then((r) => r.length && console.log('[cron] billing', r)).catch((e) => console.error('[cron] billing', e)); }, opts);
  cron.schedule('0 9 * * *', () => { runDailyNotices().then((r) => r.length && console.log('[cron] notices', r)).catch((e) => console.error('[cron] notices', e)); }, opts);
}

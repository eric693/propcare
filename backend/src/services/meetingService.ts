import { Community, Meeting } from '@prisma/client';
import { prisma } from '../prisma';
import { addDays, byLabel, dateStr, daysBetween, todayStr } from '../utils/dates';

/**
 * 區分所有權人會議的出席與表決計算（公寓大廈管理條例）：
 * - 第 27 條：每一專有部分有一表決權 → 以「戶」為單位計人數，比例以區分所有權比例計；
 *   同一所有權人或受託人達全部 1/5 以上者，超過部分不計（以「所有權人」欄位姓名歸戶）。
 * - 第 31 條：出席須人數及比例都達 2/3 以上；決議須出席人數及其比例都達 3/4 以上同意。
 * - 第 32 條：未達定額時重新召集：出席須 3 人並 1/5 以上（人數及比例），決議須出席人數及比例都「過半數」。
 * - 第 30 條：開會通知須於開會前 10 日送達；急迫情事得以公告為之，公告期間不得少於 2 日。
 * 規約另有規定時，可在社區設定改定額。
 */
export interface Capped { kind: '所有權人' | '受託人'; name: string; units: number; countedUnits: number; share: number; countedShare: number }

export interface QuorumResult {
  totalUnits: number; totalShare: number;
  attendUnits: number; attendShare: number;
  attendRate: number; attendShareRate: number;
  required: number; minPeople: number; met: boolean; shareMissing: boolean;
  capped: Capped[];
  /** 每戶實際計入的權重（人數、比例），超過 1/5 上限時小於 1 */
  weights: Record<string, { n: number; s: number }>;
}

const EPS = 1e-9;
type U = { id: string; share: number; ownerName?: string };

/**
 * 第 27 條第 2、3 項：任一區分所有權人（或受託人）的專有部分個數或區分所有權比例
 * 達全部 1/5 以上者，超過部分不予計算。先依所有權人、再依受託人等比例折算該組每戶的權重。
 * 分母（全體人數與比例）維持不變，避免把排除的部分當作不存在而放寬門檻。
 */
function weightsOf(units: U[], attend: Map<string, string>, totalUnits: number, totalShare: number) {
  const capN = Math.floor(totalUnits / 5), capS = totalShare / 5;
  const w = new Map<string, { n: number; s: number }>();
  const attended = units.filter((u) => attend.has(u.id));
  for (const u of attended) w.set(u.id, { n: 1, s: u.share });
  const capped: Capped[] = [];
  // 不足 5 戶時 1/5 不到 1 戶，條文無從適用（否則永遠達不到定額）
  if (capN < 1) return { w, capped };
  const applyCap = (kind: Capped['kind'], keyOf: (u: U) => string) => {
    const groups = new Map<string, U[]>();
    for (const u of attended) { const k = keyOf(u); if (k) groups.set(k, [...(groups.get(k) ?? []), u]); }
    for (const [name, g] of groups) {
      const n = g.reduce((t, u) => t + w.get(u.id)!.n, 0), sh = g.reduce((t, u) => t + w.get(u.id)!.s, 0);
      const fN = capN > 0 && n > capN ? capN / n : 1;
      const fS = capS > 0 && sh > capS + EPS ? capS / sh : 1;
      if (fN === 1 && fS === 1) continue;
      for (const u of g) { const x = w.get(u.id)!; w.set(u.id, { n: x.n * fN, s: x.s * fS }); }
      capped.push({ kind, name, units: g.length, countedUnits: Math.round(n * fN * 100) / 100, share: sh, countedShare: sh * fS });
    }
  };
  applyCap('所有權人', (u) => (u.ownerName ?? '').trim());
  applyCap('受託人', (u) => (attend.get(u.id) ?? '').trim());
  return { w, capped };
}

export function quorumOf(c: Community, m: Pick<Meeting, 'kind' | 'reconvene'>, units: U[], attend: Map<string, string>): QuorumResult {
  const totalUnits = units.length;
  const totalShare = units.reduce((s, u) => s + u.share, 0);
  const { w, capped } = weightsOf(units, attend, totalUnits, totalShare);
  const attendUnits = [...w.values()].reduce((t, x) => t + x.n, 0);
  const attendShare = [...w.values()].reduce((t, x) => t + x.s, 0);
  const shareMissing = totalShare <= 0;
  const required = m.reconvene ? c.quorumReAttend : c.quorumAttend;
  const minPeople = m.reconvene ? 3 : 0;
  const attendRate = totalUnits ? attendUnits / totalUnits : 0;
  const attendShareRate = shareMissing ? attendRate : attendShare / totalShare;
  const met = attendUnits + EPS >= minPeople && attendRate + EPS >= required && attendShareRate + EPS >= required;
  return { totalUnits, totalShare, attendUnits, attendShare, attendRate, attendShareRate, required, minPeople, met, shareMissing, capped, weights: Object.fromEntries(w) };
}

export interface MotionResult {
  yes: number; no: number; abstain: number; notVoted: number;
  yesShare: number; yesRate: number; yesShareRate: number;
  required: number; strict: boolean; passed: boolean;
}

export function motionOf(c: Community, m: Pick<Meeting, 'reconvene'>, q: QuorumResult,
  units: U[], votes: Map<string, string>): MotionResult {
  let yes = 0, no = 0, abstain = 0, yesN = 0, yesShare = 0;
  for (const u of units) {
    const wt = q.weights[u.id];
    if (!wt) continue;                          // 未出席者的票不算
    const v = votes.get(u.id);
    if (v === 'YES') { yes++; yesN += wt.n; yesShare += wt.s; } else if (v === 'NO') no++; else if (v === 'ABSTAIN') abstain++;
  }
  const attendCount = Object.keys(q.weights).length;
  const notVoted = attendCount - yes - no - abstain;
  const yesRate = q.attendUnits ? yesN / q.attendUnits : 0;
  const yesShareRate = q.shareMissing ? yesRate : q.attendShare ? yesShare / q.attendShare : 0;
  const required = m.reconvene ? c.quorumRePass : c.quorumPass;
  const strict = m.reconvene;                   // 「過半數」須超過一半；「四分之三以上」含等於
  const ok = (r: number) => (strict ? r > required + EPS : r + EPS >= required);
  return { yes, no, abstain, notVoted, yesShare, yesRate, yesShareRate, required, strict, passed: q.met && ok(yesRate) && ok(yesShareRate) };
}

/**
 * 第 32 條：重新召集會議的決議，於 10 日內送達並公告；區分所有權人於送達後 7 日內
 * 以書面表示反對，反對意見之人數及比例皆超過全體半數者，決議不成立。
 */
export interface Finality { status: 'FINAL' | 'NEED_NOTICE' | 'OBJECTION_PERIOD' | 'OBJECTED'; label: string; deadline: string; objectUnits: number; objectShare: number }

export function finalityOf(m: Pick<Meeting, 'reconvene' | 'meetingDate' | 'minutesSentDate'>, passed: boolean, units: U[], objections: string[], today = todayStr()): Finality | null {
  if (!m.reconvene || !passed) return null;
  const totalUnits = units.length, totalShare = units.reduce((t, u) => t + u.share, 0);
  const obj = new Set(objections);
  const objectUnits = units.filter((u) => obj.has(u.id)).length;
  const objectShare = units.filter((u) => obj.has(u.id)).reduce((t, u) => t + u.share, 0);
  const base = { objectUnits, objectShare };
  if (!m.minutesSentDate) {
    const deadline = addDays(dateStr(m.meetingDate), 10);
    return { ...base, status: 'NEED_NOTICE', deadline, label: `待送達並公告決議（${deadline} 前），送達後 7 日內受理書面反對` };
  }
  const deadline = addDays(dateStr(m.minutesSentDate), 7);
  const over = objectUnits / (totalUnits || 1) > 0.5 && (totalShare <= 0 || objectShare / totalShare > 0.5);
  if (over) return { ...base, status: 'OBJECTED', deadline, label: '書面反對已過半，決議不成立' };
  if (today <= deadline) return { ...base, status: 'OBJECTION_PERIOD', deadline, label: `異議期中，至 ${deadline} 止（已收書面反對 ${objectUnits} 戶）` };
  return { ...base, status: 'FINAL', deadline, label: '異議期屆滿，反對未過半，決議成立' };
}

/** 第 34 條：會議紀錄應於會後 15 日內送達各區分所有權人並公告（重新召集的決議為 10 日） */
export function minutesCheck(m: Pick<Meeting, 'kind' | 'status' | 'reconvene' | 'meetingDate' | 'minutesSentDate'>, today = todayStr()) {
  if (m.kind !== 'OWNERS' || m.status !== 'HELD') return null;
  const days = m.reconvene ? 10 : 15;
  const deadline = addDays(dateStr(m.meetingDate), days);
  if (m.minutesSentDate) {
    const sent = dateStr(m.minutesSentDate);
    return { ok: sent <= deadline, deadline, sent, message: sent <= deadline ? '' : `會議紀錄於 ${sent} 送達，已逾第 ${m.reconvene ? 32 : 34} 條 ${days} 日期限（${deadline}）` };
  }
  const left = daysBetween(today, deadline);
  return { ok: false, deadline, sent: '', message: left >= 0 ? `會議紀錄須於 ${deadline} 前送達各區分所有權人並公告（剩 ${left} 天）` : `會議紀錄已逾送達期限（${deadline}），請儘速送達並公告` };
}

/** 開會通知是否符合第 30 條期限（只檢查區分所有權人會議） */
export function noticeCheck(m: Pick<Meeting, 'kind' | 'urgent' | 'noticeDate' | 'meetingDate'>) {
  if (m.kind !== 'OWNERS') return { required: 0, days: null as number | null, ok: true, message: '' };
  const required = m.urgent ? 2 : 10;
  if (!m.noticeDate) return { required, days: null, ok: false, message: `尚未登錄開會通知日（須於開會前 ${required} 日${m.urgent ? '公告' : '通知'}）` };
  const days = daysBetween(dateStr(m.noticeDate), dateStr(m.meetingDate));
  const ok = days >= required;
  return { required, days, ok, message: ok ? '' : `通知日距開會僅 ${days} 日，未達第 30 條規定的 ${required} 日` };
}

/** 會議完整結果：出席、各議案表決 */
export async function meetingResult(meetingId: string, communityId: string) {
  const m = await prisma.meeting.findFirst({
    where: { id: meetingId, communityId },
    include: { attendance: true, motions: { include: { votes: true, objections: true }, orderBy: { seq: 'asc' } }, community: true },
  });
  if (!m) return null;
  const units = (await prisma.unit.findMany({ where: { communityId, active: true }, select: { id: true, label: true, building: true, share: true, ownerName: true } })).sort(byLabel);
  const attend = new Map(m.attendance.map((a) => [a.unitId, a.proxy]));
  const quorum = quorumOf(m.community, m, units, attend);
  const motions = m.motions.map((mo) => {
    const votes = new Map(mo.votes.map((v) => [v.unitId, v.vote as string]));
    const result = motionOf(m.community, m, quorum, units, votes);
    const objections = mo.objections.map((o) => o.unitId);
    return { id: mo.id, seq: mo.seq, title: mo.title, description: mo.description, votes: Object.fromEntries(votes), result, objections, finality: finalityOf(m, result.passed, units, objections) };
  });
  const { community, attendance, motions: _m, ...meeting } = m;
  return {
    meeting: { ...meeting, meetingDate: dateStr(m.meetingDate), noticeDate: dateStr(m.noticeDate), minutesSentDate: dateStr(m.minutesSentDate) },
    units, attendance: attendance.map((a) => ({ unitId: a.unitId, proxy: a.proxy, signedAt: a.signedAt })),
    quorum, motions, notice: noticeCheck(m), minutesCheck: minutesCheck(m),
  };
}

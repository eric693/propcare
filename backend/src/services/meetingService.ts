import { Community, Meeting } from '@prisma/client';
import { prisma } from '../prisma';
import { byLabel, dateStr, daysBetween } from '../utils/dates';

/**
 * 區分所有權人會議的出席與表決計算（公寓大廈管理條例）：
 * - 第 27 條：每一專有部分有一表決權 → 以「戶」為單位計人數，比例以區分所有權比例計。
 * - 第 31 條：出席須人數及比例都達 2/3 以上；決議須出席人數及其比例都達 3/4 以上同意。
 * - 第 32 條：未達定額時重新召集：出席須 3 人並 1/5 以上（人數及比例），決議須出席人數及比例都「過半數」。
 * - 第 30 條：開會通知須於開會前 10 日送達；急迫情事得以公告為之，公告期間不得少於 2 日。
 * 規約另有規定時，可在社區設定改定額。
 */
export interface QuorumResult {
  totalUnits: number; totalShare: number;
  attendUnits: number; attendShare: number;
  attendRate: number; attendShareRate: number;
  required: number; minPeople: number; met: boolean; shareMissing: boolean;
}

const EPS = 1e-9;

export function quorumOf(c: Community, m: Pick<Meeting, 'kind' | 'reconvene'>, units: { id: string; share: number }[], attendIds: Set<string>): QuorumResult {
  const totalUnits = units.length;
  const totalShare = units.reduce((s, u) => s + u.share, 0);
  const attended = units.filter((u) => attendIds.has(u.id));
  const attendUnits = attended.length;
  const attendShare = attended.reduce((s, u) => s + u.share, 0);
  const shareMissing = totalShare <= 0;
  const required = m.reconvene ? c.quorumReAttend : c.quorumAttend;
  const minPeople = m.reconvene ? 3 : 0;
  const attendRate = totalUnits ? attendUnits / totalUnits : 0;
  const attendShareRate = shareMissing ? attendRate : attendShare / totalShare;
  const met = attendUnits >= minPeople && attendRate + EPS >= required && attendShareRate + EPS >= required;
  return { totalUnits, totalShare, attendUnits, attendShare, attendRate, attendShareRate, required, minPeople, met, shareMissing };
}

export interface MotionResult {
  yes: number; no: number; abstain: number; notVoted: number;
  yesShare: number; yesRate: number; yesShareRate: number;
  required: number; strict: boolean; passed: boolean;
}

export function motionOf(c: Community, m: Pick<Meeting, 'reconvene'>, q: QuorumResult,
  units: { id: string; share: number }[], attendIds: Set<string>, votes: Map<string, string>): MotionResult {
  let yes = 0, no = 0, abstain = 0, yesShare = 0;
  for (const u of units) {
    if (!attendIds.has(u.id)) continue;         // 未出席者的票不算
    const v = votes.get(u.id);
    if (v === 'YES') { yes++; yesShare += u.share; } else if (v === 'NO') no++; else if (v === 'ABSTAIN') abstain++;
  }
  const notVoted = q.attendUnits - yes - no - abstain;
  const yesRate = q.attendUnits ? yes / q.attendUnits : 0;
  const yesShareRate = q.shareMissing ? yesRate : q.attendShare ? yesShare / q.attendShare : 0;
  const required = m.reconvene ? c.quorumRePass : c.quorumPass;
  const strict = m.reconvene;                   // 「過半數」須超過一半；「四分之三以上」含等於
  const ok = (r: number) => (strict ? r > required + EPS : r + EPS >= required);
  return { yes, no, abstain, notVoted, yesShare, yesRate, yesShareRate, required, strict, passed: q.met && ok(yesRate) && ok(yesShareRate) };
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
    include: { attendance: true, motions: { include: { votes: true }, orderBy: { seq: 'asc' } }, community: true },
  });
  if (!m) return null;
  const units = (await prisma.unit.findMany({ where: { communityId, active: true }, select: { id: true, label: true, building: true, share: true, ownerName: true } })).sort(byLabel);
  const attendIds = new Set(m.attendance.map((a) => a.unitId));
  const quorum = quorumOf(m.community, m, units, attendIds);
  const motions = m.motions.map((mo) => {
    const votes = new Map(mo.votes.map((v) => [v.unitId, v.vote as string]));
    return { id: mo.id, seq: mo.seq, title: mo.title, description: mo.description, votes: Object.fromEntries(votes), result: motionOf(m.community, m, quorum, units, attendIds, votes) };
  });
  const { community, attendance, motions: _m, ...meeting } = m;
  return {
    meeting: { ...meeting, meetingDate: dateStr(m.meetingDate), noticeDate: dateStr(m.noticeDate) },
    units, attendance: attendance.map((a) => ({ unitId: a.unitId, proxy: a.proxy, signedAt: a.signedAt })),
    quorum, motions, notice: noticeCheck(m),
  };
}

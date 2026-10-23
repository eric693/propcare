import { Facility } from '@prisma/client';
import { prisma } from '../prisma';
import { HttpError } from './feeService';
import { addDays, daysBetween, taipeiClock, toDate, todayStr } from '../utils/dates';

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toTime = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

/** 設施當日所有時段與剩餘名額 */
export async function slotsOf(f: Facility, date: string) {
  const booked = await prisma.booking.findMany({ where: { facilityId: f.id, date: toDate(date), status: 'BOOKED' }, include: { unit: { select: { label: true } } } });
  const out = [];
  for (let t = toMin(f.openTime); t + f.slotMinutes <= toMin(f.closeTime); t += f.slotMinutes) {
    const s = toTime(t), e = toTime(t + f.slotMinutes);
    const taken = booked.filter((b) => toMin(b.startTime) < t + f.slotMinutes && toMin(b.endTime) > t);
    out.push({ start: s, end: e, left: Math.max(0, f.capacity - taken.length), units: taken.map((b) => b.unit.label) });
  }
  return out;
}

/**
 * 預約規則：須在開放時段內且對齊時段、不能預約過去、不超過可提前天數、
 * 同時段不超過容量、每戶每週（週一至週日）不超過上限。住戶端與管理端共用。
 */
export async function createBooking(input: {
  communityId: string; facilityId: string; unitId: string; residentId?: string;
  date: string; startTime: string; people?: number; note?: string; by: string;
}) {
  const f = await prisma.facility.findFirst({ where: { id: input.facilityId, communityId: input.communityId, active: true } });
  if (!f) throw new HttpError(404, '找不到這個公共設施或已停用');
  const today = todayStr();
  const ahead = daysBetween(today, input.date);
  if (ahead < 0) throw new HttpError(400, '不能預約過去的日期');
  if (ahead > f.advanceDays) throw new HttpError(400, `最多只能提前 ${f.advanceDays} 天預約`);
  const start = toMin(input.startTime);
  if (start < toMin(f.openTime) || start + f.slotMinutes > toMin(f.closeTime) || (start - toMin(f.openTime)) % f.slotMinutes !== 0) {
    throw new HttpError(400, `請選擇 ${f.openTime}～${f.closeTime} 之間的時段`);
  }
  if (ahead === 0) {
    const { hour, minute } = taipeiClock();
    if (start <= hour * 60 + minute) throw new HttpError(400, '這個時段已經開始，不能預約');
  }
  const end = toTime(start + f.slotMinutes);
  return prisma.$transaction(async (tx) => {
    const overlap = await tx.booking.findMany({ where: { facilityId: f.id, date: toDate(input.date), status: 'BOOKED' } });
    const clash = overlap.filter((b) => toMin(b.startTime) < start + f.slotMinutes && toMin(b.endTime) > start);
    if (clash.some((b) => b.unitId === input.unitId)) throw new HttpError(409, '您已預約這個時段');
    if (clash.length >= f.capacity) throw new HttpError(409, '這個時段已額滿');
    if (f.maxPerWeek > 0) {
      const d = toDate(input.date);
      const dow = (d.getUTCDay() + 6) % 7;                 // 週一＝0
      const mon = addDays(input.date, -dow);
      const n = await tx.booking.count({ where: { facilityId: f.id, unitId: input.unitId, status: 'BOOKED', date: { gte: toDate(mon), lte: toDate(addDays(mon, 6)) } } });
      if (n >= f.maxPerWeek) throw new HttpError(409, `每戶每週最多預約 ${f.maxPerWeek} 次，本週已達上限`);
    }
    return tx.booking.create({
      data: {
        communityId: input.communityId, facilityId: f.id, unitId: input.unitId, residentId: input.residentId,
        date: toDate(input.date), startTime: input.startTime, endTime: end, people: input.people ?? 1, note: input.note ?? '', createdBy: input.by,
      },
    });
  }, { isolationLevel: 'Serializable' });
}

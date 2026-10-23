// 日期工具：系統以台北日期為準。@db.Date 欄位一律用 UTC 午夜的 Date 表示該日。

const TZ = 'Asia/Taipei';

/** 台北今天 YYYY-MM-DD */
export function todayStr(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** 台北目前的時、分 */
export function taipeiClock(d = new Date()): { hour: number; minute: number } {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
    .format(d).split(':').map(Number);
  return { hour: h % 24, minute: m };
}

/** 'YYYY-MM-DD' → Date（UTC 午夜），給 @db.Date 欄位用 */
export function toDate(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`日期格式不正確：${s}`);
  return new Date(`${s}T00:00:00.000Z`);
}

/** Date（@db.Date）→ 'YYYY-MM-DD' */
export function dateStr(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : '';
}

export function addDays(s: string, n: number): string {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return dateStr(d);
}

/** 加月份，月底對齊（1/31 + 1 個月 → 2/28） */
export function addMonths(s: string, n: number): string {
  const [y, m, dd] = s.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(dd, last));
  return dateStr(first);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);
}

/** 期別（YYYY-MM）的繳費期限：該月 dueDay 日，月份較短時取月底 */
export function periodDue(period: string, dueDay: number): string {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${String(Math.min(Math.max(dueDay, 1), last)).padStart(2, '0')}`;
}

export function isPeriod(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

/** 兩個期別之間相差幾期（a 早於 b 為正） */
export function periodDiff(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

/** 戶別自然排序：A棟 2F-1 排在 A棟 10F-1 前面 */
export function byLabel<T extends { label: string; building?: string }>(a: T, b: T): number {
  return (a.building ?? '').localeCompare(b.building ?? '', 'zh-Hant', { numeric: true })
    || a.label.localeCompare(b.label, 'zh-Hant', { numeric: true });
}

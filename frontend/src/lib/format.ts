export const money = (n: number | null | undefined) => `${Math.round(n ?? 0).toLocaleString('zh-TW')}`;
export const nt = (n: number | null | undefined) => `NT$ ${money(n)}`;
export const d10 = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : '');
export const dt = (s: string | null | undefined) => {
  if (!s) return '';
  const d = new Date(s);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
export const pct = (v: number | null | undefined, digits = 1) => (v == null ? '-' : `${(v * 100).toFixed(digits)}%`);

/** 台北今天 YYYY-MM-DD */
export function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export const thisMonth = () => today().slice(0, 7);
export function addDays(s: string, n: number) {
  const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
export function addMonth(p: string, n: number) {
  const [y, m] = p.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7);
}
export const daysFrom = (s: string) => Math.round((new Date(`${d10(s)}T00:00:00Z`).getTime() - new Date(`${today()}T00:00:00Z`).getTime()) / 86400000);

export const L = {
  role: { ADMIN: '物業公司管理員', MANAGER: '總幹事／秘書', COMMITTEE: '管委會委員' } as Record<string, string>,
  occupancy: { SELF: '自住', RENT: '出租', VACANT: '空屋', SHOP: '店面' } as Record<string, string>,
  relation: { OWNER: '所有權人', TENANT: '承租人', FAMILY: '家屬' } as Record<string, string>,
  bill: { UNPAID: '未繳', PARTIAL: '部分繳', PAID: '已繳清', VOID: '已作廢' } as Record<string, string>,
  billCls: { UNPAID: 'badge-bad', PARTIAL: 'badge-warn', PAID: 'badge-ok', VOID: 'badge-mute' } as Record<string, string>,
  method: { CASH: '現金', TRANSFER: '匯款', ATM: 'ATM 轉帳', STORE: '超商代收', OTHER: '其他' } as Record<string, string>,
  fund: { MGMT: '管理費帳戶', RESERVE: '公共基金' } as Record<string, string>,
  approval: { PENDING: '待核准', APPROVED: '已核准', REJECTED: '已退回' } as Record<string, string>,
  pkgKind: { PARCEL: '包裹', MAIL: '信件', REGISTERED: '掛號', COLD: '冷藏', LARGE: '大型' } as Record<string, string>,
  pkgStatus: { WAITING: '待領', PICKED: '已領', RETURNED: '已退回' } as Record<string, string>,
  repair: { NEW: '待處理', ASSIGNED: '已派工', WORKING: '處理中', DONE: '已完工', CLOSED: '已結案', REJECTED: '不受理' } as Record<string, string>,
  repairCls: { NEW: 'badge-bad', ASSIGNED: 'badge-warn', WORKING: 'badge-info', DONE: 'badge-ok', CLOSED: 'badge-mute', REJECTED: 'badge-mute' } as Record<string, string>,
  priority: { URGENT: '急件', HIGH: '優先', NORMAL: '一般', LOW: '低' } as Record<string, string>,
  priorityCls: { URGENT: 'badge-bad', HIGH: 'badge-warn', NORMAL: 'badge-mute', LOW: 'badge-mute' } as Record<string, string>,
  area: { PUBLIC: '公共區域', PRIVATE: '室內（專有部分）' } as Record<string, string>,
  meetingKind: { OWNERS: '區分所有權人會議', COMMITTEE: '管理委員會會議' } as Record<string, string>,
  meetingStatus: { PLANNED: '籌備中', HELD: '已召開', CANCELLED: '已取消' } as Record<string, string>,
  vote: { YES: '同意', NO: '不同意', ABSTAIN: '棄權' } as Record<string, string>,
};

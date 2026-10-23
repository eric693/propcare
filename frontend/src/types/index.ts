export interface Me {
  id: string; username: string; name: string; role: 'ADMIN' | 'MANAGER' | 'COMMITTEE'; title: string; phone: string;
  lineBound: boolean; isDemo: boolean; communities: { id: string; name: string }[];
}
export interface Community {
  id: string; name: string; address: string; phone: string; feeMode: 'AREA' | 'FIXED'; feeRate: number; reserveRatio: number;
  dueDay: number; autoBillDay: number; remindDaysBefore: number; bankInfo: string; openingMgmt: number; openingReserve: number;
  openingDate: string; quorumAttend: number; quorumPass: number; quorumReAttend: number; quorumRePass: number;
  packageOverdueDays: number; note: string;
}
export interface Resident { id: string; name: string; phone: string; email: string; relation: string; lineBound: boolean; lastLogin: string | null; note: string }
export interface Unit {
  id: string; label: string; building: string; floor: string; no: string; area: number; share: number; feeOverride: number | null;
  occupancy: string; ownerName: string; note: string; residents: Resident[]; parkingSpaces: { id: string; code: string; monthlyFee: number; kind: string }[];
  monthlyFee: number; owed: { amount: number; count: number };
}
export interface Bill {
  id: string; unitId: string; period: string; amountMgmt: number; amountParking: number; amountOther: number; otherNote: string;
  total: number; paid: number; dueDate: string; status: string; unit: { label: string; ownerName: string };
  payments: { receiptNo: string; paidDate: string; amount: number; method: string }[];
}

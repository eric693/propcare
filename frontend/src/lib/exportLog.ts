import api from '../api/client';

/** 匯出資料時留下稽核紀錄（個資法：個人資料的利用留存軌跡）；失敗不影響下載 */
export const logExport = (what: string, rows: number) => { api.post('/export-log', { what, rows }).catch(() => {}); };

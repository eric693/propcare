// 管理端與住戶端共用的小工具（放這裡，住戶端就不必載入管理端頁面的程式）
import type { AxiosInstance } from 'axios';
import api, { errMsg } from '../api/client';
import { toast } from '../components/ui';

export const FEEDBACK_CATEGORIES = ['建議', '抱怨', '噪音', '環境清潔', '停車', '寵物', '其他'];

export const fileSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** 以登入身分開啟檔案（檔案 API 需要授權標頭，不能直接用連結） */
export async function openFile(url: string, client: AxiosInstance = api) {
  try {
    const r = await client.get(url, { responseType: 'blob' });
    window.open(URL.createObjectURL(r.data), '_blank');
  } catch (e) { toast(errMsg(e), true); }
}

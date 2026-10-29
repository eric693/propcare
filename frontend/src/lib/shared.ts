// 管理端與住戶端共用的小工具（放這裡，住戶端就不必載入管理端頁面的程式）
import type { AxiosInstance } from 'axios';
import api, { errMsg } from '../api/client';
import { toast } from '../components/ui';

export const FEEDBACK_CATEGORIES = ['建議', '抱怨', '噪音', '環境清潔', '停車', '寵物', '其他'];

export const fileSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** 以登入身分下載檔案（檔案 API 需要授權標頭，不能直接用連結；網站安全政策不允許在新分頁開啟 blob） */
export async function openFile(url: string, client: AxiosInstance = api, fileName = '') {
  try {
    const r = await client.get(url, { responseType: 'blob' });
    const name = fileName || decodeURIComponent((String(r.headers['content-disposition'] ?? '').match(/filename\*=UTF-8''([^;]+)/) ?? [])[1] ?? 'download');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(r.data); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch (e) { toast(errMsg(e), true); }
}

import axios, { AxiosInstance } from 'axios';

// 員工端與住戶端各用一組 token（分開存），員工端另外帶目前選的社區
export const STAFF_TOKEN = 'pc_token';
export const RESIDENT_TOKEN = 'pc_rtoken';
export const CID_KEY = 'pc_cid';

function make(tokenKey: string, loginPath: string, withCommunity: boolean): AxiosInstance {
  const inst = axios.create({ baseURL: '/api' });
  inst.interceptors.request.use((cfg) => {
    const t = localStorage.getItem(tokenKey);
    if (t) cfg.headers.Authorization = `Bearer ${t}`;
    const cid = withCommunity ? localStorage.getItem(CID_KEY) : null;
    if (cid) cfg.headers['X-Community'] = cid;
    return cfg;
  });
  inst.interceptors.response.use((r) => r, (err) => {
    const url: string = err.config?.url ?? '';
    if (err.response?.status === 401 && !url.includes('login')) {
      localStorage.removeItem(tokenKey);
      if (location.pathname !== loginPath) location.href = loginPath;
    }
    return Promise.reject(err);
  });
  return inst;
}

const api = make(STAFF_TOKEN, '/login', true);
export const rapi = make(RESIDENT_TOKEN, '/r/login', false);
export default api;

/** 把 API 錯誤轉成中文訊息 */
export function errMsg(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax.response?.data?.error ?? (ax.response ? '操作失敗，請稍後再試' : '連線失敗，請檢查網路');
}

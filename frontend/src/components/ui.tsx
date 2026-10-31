import { ReactNode, useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { errMsg } from '../api/client';

export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-end sm:items-center justify-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`bg-white w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'} rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92dvh] flex flex-col`}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100" aria-label="關閉"><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2 pb-safe">{footer}</div>}
      </div>
    </div>
  );
}

/** 表單用 Modal：送出時擋住重複點擊、錯誤顯示在表單底部 */
export function FormModal({ title, onClose, onSubmit, children, wide, submitText = '儲存' }: {
  title: string; onClose: () => void; onSubmit: () => Promise<void | boolean>; children: ReactNode; wide?: boolean; submitText?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function submit() {
    setBusy(true); setErr('');
    try { const r = await onSubmit(); if (r !== false) onClose(); } catch (e) { setErr(errMsg(e)); }
    setBusy(false);
  }
  return (
    <Modal title={title} onClose={onClose} wide={wide} footer={<>
      {err && <div className="text-sm text-red-600 mr-auto self-center">{err}</div>}
      <button className="btn-ghost" onClick={onClose}>取消</button>
      <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? '處理中…' : submitText}</button>
    </>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
    </Modal>
  );
}

/**
 * 表單欄位。內容含多個按鈕或控制項時請加 group：改用 div 包，
 * 避免 <label> 把點擊空白處轉給第一個按鈕（例如點已選的戶別卻觸發「重選」）。
 */
export function Field({ label, children, full, hint, group }: { label: string; children: ReactNode; full?: boolean; hint?: string; group?: boolean }) {
  const Tag = group ? 'div' : 'label';
  return (
    <Tag className={`block ${full ? 'sm:col-span-2' : ''}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="block text-xs text-gray-400 mt-1 leading-relaxed">{hint}</span>}
    </Tag>
  );
}

export function Stat({ label, value, sub, tone, onClick }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'bad' | 'warn' | 'ok'; onClick?: () => void }) {
  const color = tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : tone === 'ok' ? 'text-green-700' : 'text-gray-800';
  return (
    <div className={`card ${onClick ? 'cursor-pointer hover:border-brand/40 transition-colors' : ''}`} onClick={onClick}>
      <div className="text-xs text-gray-400 font-medium">{label}</div>
      <div className={`text-2xl font-bold mt-1 num tracking-tight ${color}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string, number?][] }) {
  return (
    <div className="flex gap-1 bg-white rounded-xl p-1 mb-4 shadow-sm border border-gray-100 overflow-x-auto">
      {items.map(([k, label, n]) => (
        <button key={k} onClick={() => onChange(k)} className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${value === k ? 'bg-brand text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
          {label}{n != null && <span className="ml-1 opacity-70">({n})</span>}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card text-center py-10 text-gray-400 text-sm">{children}</div>;
}

export function Loading() {
  return <div className="text-center py-10 text-gray-400 text-sm">載入中…</div>;
}

export function ErrorBox({ error }: { error: string }) {
  return error ? <div className="card border-red-200 bg-red-50 text-red-700 text-sm">{error}</div> : null;
}

/** 簡單的資料載入 hook：deps 變動就重抓；回傳 reload */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setError('');
    fn().then((d) => alive && setData(d)).catch((e) => alive && setError(errMsg(e)));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, reload: () => setTick((t) => t + 1), setData };
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string, bad = false) {
  let el = document.getElementById('pc-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pc-toast';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;max-width:calc(100% - 32px);color:#fff;font-size:14px;padding:10px 16px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.18)';
    document.body.appendChild(el);
  }
  el.style.background = bad ? '#dc2626' : '#0f6b6f';
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (el) el.style.display = 'none'; }, bad ? 4500 : 2500);
}

/** 執行動作並提示結果 */
export async function act(fn: () => Promise<unknown>, ok?: string) {
  try { await fn(); if (ok) toast(ok); return true; } catch (e) { toast(errMsg(e), true); return false; }
}

/** 搜尋：多個欄位任一包含關鍵字（不分大小寫，空白分隔的每個字都要符合） */
export function matches(q: string, ...fields: unknown[]): boolean {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fields.map((f) => String(f ?? '')).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function SearchBox({ value, onChange, placeholder = '搜尋' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative flex-1 min-w-[12rem] max-w-sm">
      <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input className="input pl-9 pr-8" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {value && <button type="button" onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-gray-100" aria-label="清除搜尋"><X className="w-3.5 h-3.5 text-gray-400" /></button>}
    </div>
  );
}

/** 篩選下拉：第一個選項是「全部」 */
export function Filter({ value, onChange, all, options }: { value: string; onChange: (v: string) => void; all: string; options: string[][] | Record<string, string> }) {
  const opts = Array.isArray(options) ? options : Object.entries(options);
  return (
    <select className="input w-auto" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{all}</option>
      {opts.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  );
}

export function Toolbar({ children, count }: { children: ReactNode; count?: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 mb-3">{children}{count != null && <span className="text-xs text-gray-400 ml-auto">{count}</span>}</div>;
}

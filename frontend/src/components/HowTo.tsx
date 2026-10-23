import { useState } from 'react';
import { ChevronDown, HelpCircle, AlertCircle } from 'lucide-react';
import { HOWTO } from '../content/howto';

/** 模組操作說明：預設收合，展開狀態記在 localStorage */
export default function HowTo({ module }: { module: string }) {
  const content = HOWTO[module];
  const key = `howto:${module}`;
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) === '1'; } catch { return false; } });
  if (!content) return null;
  const toggle = () => { setOpen(!open); try { localStorage.setItem(key, open ? '0' : '1'); } catch { /* 忽略 */ } };
  return (
    <div className="mb-4 bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm no-print">
      <button onClick={toggle} className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50">
        <HelpCircle className="w-4 h-4 text-brand flex-shrink-0" />
        <span className="text-sm font-semibold text-gray-700">操作說明</span>
        <span className="text-xs text-gray-400 truncate hidden sm:block">{content.purpose}</span>
        <ChevronDown className={`w-4 h-4 text-gray-400 ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-50">
          <p className="text-xs text-gray-500 mb-3 sm:hidden">{content.purpose}</p>
          <ol className="space-y-2">
            {content.steps.map((s, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="w-5 h-5 rounded-full bg-brand-light text-brand text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                <span className="text-sm text-gray-600 leading-relaxed">{s}</span>
              </li>
            ))}
          </ol>
          {content.notes?.map((n, i) => (
            <div key={i} className="flex gap-2 mt-3 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />{n}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

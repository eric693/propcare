import { useEffect, useRef, useState, type ReactNode } from 'react';

/** 圖表色票：依固定順序配色，不循環；超過的項目併入「其他」 */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
const OTHER = '#9ca3af';

interface Tip { x: number; y: number; body: ReactNode }

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-gray-900/90 px-2.5 py-1.5 text-xs text-white shadow-lg whitespace-nowrap"
      style={{ left: tip.x, top: tip.y - 8 }}>{tip.body}</div>
  );
}

function Swatch({ color }: { color: string }) {
  return <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color }} />;
}

export function ChartCard({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="card flex flex-col min-w-0">
      <div className="mb-3"><h3 className="font-semibold text-sm">{title}</h3>{sub && <div className="text-xs text-gray-400">{sub}</div>}</div>
      {/* 與旁邊較高的卡片並排時，內容垂直置中，不在下方留一大片空白 */}
      <div className="flex-1 flex flex-col justify-center">{children}</div>
    </div>
  );
}

function ChartEmpty({ children }: { children: ReactNode }) {
  return <div className="h-40 flex items-center justify-center text-sm text-gray-400">{children}</div>;
}

/** 取「好讀」的刻度上限（1/2/5 × 10^n） */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

/** 支出依科目合計（兩個帳戶同科目合併），由大到小 */
export function expenseByCategory(items: { direction: string; category: string; amount: number }[]) {
  const m = new Map<string, number>();
  for (const i of items) if (i.direction === 'OUT') m.set(i.category, (m.get(i.category) ?? 0) + i.amount);
  return [...m].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

// ── 長條圖（可多組並排）─────────────────────────────────────────────

export interface BarSeries { name: string; values: (number | null)[] }

/** 量測容器寬度：SVG 依實際寬度繪製，手機上文字才不會被等比縮小 */
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e.contentRect.width && setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function BarChart({ labels, series, format = String, max, height = 200, integer }: {
  labels: string[]; series: BarSeries[]; format?: (v: number) => string; max?: number; height?: number; integer?: boolean;
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [ref, W] = useWidth(560);
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  if (!all.some((v) => v > 0)) return <div ref={ref}><ChartEmpty>尚無資料</ChartEmpty></div>;

  const padL = 52, padB = 24, padT = 8, H = height;
  // 件數、戶數類的資料刻度取 4 的倍數，避免出現 2.5 戶
  const top = max ?? (integer ? Math.max(4, Math.ceil(Math.max(...all) / 4) * 4) : niceMax(Math.max(...all)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => top * f);
  const plotH = H - padB - padT, slot = (W - padL) / labels.length;
  const gap = 2, barW = Math.min(28, (slot * 0.7 - gap * (series.length - 1)) / series.length);
  const groupW = barW * series.length + gap * (series.length - 1);
  const y = (v: number) => padT + plotH - (Math.min(v, top) / top) * plotH;

  return (
    <div ref={ref} className="relative" onMouseLeave={() => setTip(null)}>
      {series.length > 1 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-xs text-gray-600">
          {series.map((s, i) => <span key={s.name} className="inline-flex items-center gap-1.5"><Swatch color={SERIES[i]} />{s.name}</span>)}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} height={H} className="block w-full" role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#d1d5db' : '#f3f4f6'} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#9ca3af">{format(t)}</text>
          </g>
        ))}
        {labels.map((label, i) => {
          const x0 = padL + slot * i + (slot - groupW) / 2;
          return (
            <g key={label}>
              <text x={padL + slot * i + slot / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="#6b7280">{label}</text>
              {series.map((s, k) => {
                const v = s.values[i];
                if (v == null || v <= 0) return null;
                const x = x0 + k * (barW + gap), yy = y(v), h = padT + plotH - yy, r = Math.min(4, barW / 2, h);
                return <path key={s.name} fill={SERIES[k]} d={`M${x},${padT + plotH}V${yy + r}Q${x},${yy} ${x + r},${yy}H${x + barW - r}Q${x + barW},${yy} ${x + barW},${yy + r}V${padT + plotH}Z`} />;
              })}
              {/* 整組的感應區比長條大，滑過即顯示該月所有數值 */}
              <rect x={padL + slot * i} y={padT} width={slot} height={plotH} fill="transparent"
                onMouseMove={(e) => {
                  const box = (e.currentTarget.ownerSVGElement!.parentElement as HTMLElement).getBoundingClientRect();
                  setTip({ x: e.clientX - box.left, y: e.clientY - box.top, body: (
                    <><div className="font-semibold mb-0.5">{label}</div>
                      {series.map((s, k) => <div key={s.name} className="flex items-center gap-1.5">{series.length > 1 && <Swatch color={SERIES[k]} />}{s.name}：{s.values[i] == null ? '—' : format(s.values[i]!)}</div>)}</>
                  ) });
                }} />
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

// ── 橫向長條圖（項目名稱較長時，例如各社區比較）──────────────────────

export function HBarChart({ items, format = String, max }: { items: { label: string; value: number | null; onClick?: () => void }[]; format?: (v: number) => string; max?: number }) {
  const top = max ?? niceMax(Math.max(0, ...items.map((i) => i.value ?? 0)));
  if (!items.length) return <ChartEmpty>尚無資料</ChartEmpty>;
  const few = items.length <= 4;
  return (
    <div className={few ? 'space-y-4' : 'space-y-2'}>
      {items.map((it) => (
        <div key={it.label} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3 text-sm">
          <button className={`truncate text-left ${it.onClick ? 'hover:underline text-brand' : 'cursor-default'}`} onClick={it.onClick} title={it.label}>{it.label}</button>
          <div className={`${few ? 'h-6' : 'h-3.5'} rounded bg-gray-100`} title={it.value == null ? '尚無資料' : format(it.value)}>
            {it.value != null && it.value > 0 && <div className="h-full rounded" style={{ width: `${Math.min(100, it.value / top * 100)}%`, background: SERIES[0] }} />}
          </div>
          <span className="num text-xs text-gray-600 w-14 text-right">{it.value == null ? '—' : format(it.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ── 圓餅圖（甜甜圈）────────────────────────────────────────────────

export function PieChart({ items, format = String, unit = '', maxSlices = 5 }: {
  items: { label: string; value: number }[]; format?: (v: number) => string; unit?: string; maxSlices?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const positive = items.filter((i) => i.value > 0);
  const total = positive.reduce((s, i) => s + i.value, 0);
  if (!total) return <ChartEmpty>尚無資料</ChartEmpty>;

  const shown = positive.length > maxSlices + 1 ? positive.slice(0, maxSlices) : positive;
  const rest = positive.slice(shown.length).reduce((s, i) => s + i.value, 0);
  const slices = [...shown.map((s, i) => ({ ...s, color: SERIES[i] })), ...(rest ? [{ label: '其他', value: rest, color: OTHER }] : [])];

  const R = 80, r = 50, C = 90;
  const pt = (a: number, rad: number) => `${C + rad * Math.sin(a)},${C - rad * Math.cos(a)}`;
  let acc = 0;
  const arcs = slices.map((s) => {
    const a0 = (acc / total) * Math.PI * 2; acc += s.value;
    const a1 = (acc / total) * Math.PI * 2, big = a1 - a0 > Math.PI ? 1 : 0;
    // 只有一塊時畫成完整圓環（SVG 弧線無法畫 360°）
    const d = slices.length === 1
      ? `M${C},${C - R}A${R},${R} 0 1 1 ${C - 0.01},${C - R}L${C - 0.01},${C - r}A${r},${r} 0 1 0 ${C},${C - r}Z`
      : `M${pt(a0, R)}A${R},${R} 0 ${big} 1 ${pt(a1, R)}L${pt(a1, r)}A${r},${r} 0 ${big} 0 ${pt(a0, r)}Z`;
    return { ...s, d };
  });
  const pct = (v: number) => `${Math.round(v / total * 1000) / 10}%`;
  const h = hover == null ? null : arcs[hover];

  return (
    <div className="flex flex-col sm:flex-row items-center gap-4">
      <svg viewBox="0 0 180 180" className="w-40 h-40 shrink-0" role="img" onMouseLeave={() => setHover(null)}>
        {arcs.map((a, i) => (
          <path key={a.label} d={a.d} fill={a.color} stroke="#fff" strokeWidth="2" strokeLinejoin="round"
            opacity={hover == null || hover === i ? 1 : 0.35} onMouseEnter={() => setHover(i)} className="transition-opacity" />
        ))}
        <text x={C} y={C - 4} textAnchor="middle" fontSize="11" fill="#9ca3af">{h ? h.label : '合計'}</text>
        <text x={C} y={C + 14} textAnchor="middle" fontSize="15" fontWeight="600" fill="#1f2937">{format(h ? h.value : total)}{unit}</text>
      </svg>
      <ul className="w-full sm:max-w-sm min-w-0 space-y-1.5 text-sm">
        {arcs.map((a, i) => (
          <li key={a.label} className={`flex items-center gap-2 rounded px-1 ${hover === i ? 'bg-gray-50' : ''}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <Swatch color={a.color} /><span className="truncate flex-1 text-gray-700">{a.label}</span>
            <span className="num text-gray-600">{format(a.value)}{unit}</span><span className="num text-xs text-gray-400 w-12 text-right">{pct(a.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

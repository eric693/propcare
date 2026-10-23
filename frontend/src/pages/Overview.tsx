import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import api from '../api/client';
import { Page } from '../components/Layout';
import HowTo from '../components/HowTo';
import { ErrorBox, FormModal, Field, Loading, Stat, useLoad, toast } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { money } from '../lib/format';

interface Row { id: string; name: string; units: number; billed: number; paid: number; rate: number | null; arrearsUnits: number; arrearsAmount: number; overTwo: number; packages: number; openRepairs: number; inspectionsDue: number; pendingApprovals: number; balance: { mgmt: number; reserve: number } }

export default function Overview() {
  const { user, setCid, refresh } = useAuth();
  const nav = useNavigate();
  const { data, error, reload } = useLoad(() => api.get<{ period: string; communities: Row[] }>('/overview').then((r) => r.data), []);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', address: '', feeMode: 'AREA', feeRate: '60', reserveRatio: '10', dueDay: '15' });
  const rows = data?.communities ?? [];
  const sum = (k: keyof Row) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const go = (id: string, path = '/') => { setCid(id); nav(path); };

  return (
    <Page title="公司總覽" actions={user?.role === 'ADMIN' && <button className="btn-primary" onClick={() => setAdding(true)}><Plus className="w-4 h-4" />新增社區</button>}>
      <HowTo module="overview" />
      <ErrorBox error={error} />
      {!data ? <Loading /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Stat label="管理社區" value={rows.length} sub={`共 ${money(sum('units'))} 戶`} />
            <Stat label={`${data.period} 收繳`} value={`${sum('billed') ? Math.round(sum('paid') / sum('billed') * 1000) / 10 : 0}%`} sub={`${money(sum('paid'))} / ${money(sum('billed'))} 元`} />
            <Stat label="欠費戶數" value={sum('arrearsUnits')} tone={sum('overTwo') ? 'bad' : undefined} sub={`逾二期 ${sum('overTwo')} 戶・${money(sum('arrearsAmount'))} 元`} />
            <Stat label="待處理" value={sum('openRepairs') + sum('pendingApprovals')} sub={`報修 ${sum('openRepairs')}・待核准支出 ${sum('pendingApprovals')}`} />
          </div>
          <div className="card p-0 overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>社區</th><th>戶數</th><th>本月收繳率</th><th>欠費</th><th>待領包裹</th><th>報修中</th><th>30 天內法定檢查</th><th>管理費帳戶</th><th>公共基金</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><button className="font-semibold text-brand hover:underline" onClick={() => go(r.id)}>{r.name}</button></td>
                    <td className="num">{r.units}</td>
                    <td className="num"><span className={r.rate != null && r.rate < 70 ? 'text-amber-600 font-semibold' : ''}>{r.rate == null ? '尚未開帳' : `${r.rate}%`}</span></td>
                    <td className="num"><button onClick={() => go(r.id, '/fees?tab=arrears')} className="hover:underline">{r.arrearsUnits} 戶{r.overTwo > 0 && <span className="badge-bad ml-1">逾二期 {r.overTwo}</span>}</button></td>
                    <td className="num">{r.packages}</td>
                    <td className="num">{r.openRepairs}</td>
                    <td className="num">{r.inspectionsDue ? <span className="badge-warn">{r.inspectionsDue} 項</span> : '-'}</td>
                    <td className="num">{money(r.balance.mgmt)}</td>
                    <td className="num">{money(r.balance.reserve)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {adding && (
        <FormModal title="新增社區" onClose={() => setAdding(false)} onSubmit={async () => {
          const r = await api.post('/communities', form);
          await refresh(); setCid(r.data.id); reload(); toast('社區已建立，接著請匯入戶別'); nav('/units');
        }}>
          <Field label="社區名稱" full><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="地址" full><input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          <Field label="管理費計算">
            <select className="input" value={form.feeMode} onChange={(e) => setForm({ ...form, feeMode: e.target.value })}><option value="AREA">每坪單價</option><option value="FIXED">每戶固定</option></select>
          </Field>
          <Field label={form.feeMode === 'AREA' ? '每坪單價（元）' : '每戶月費（元）'}><input className="input" type="number" value={form.feeRate} onChange={(e) => setForm({ ...form, feeRate: e.target.value })} /></Field>
          <Field label="公共基金提撥比例（%）" hint="依規約；收到的管理費中提撥到公共基金的比例"><input className="input" type="number" value={form.reserveRatio} onChange={(e) => setForm({ ...form, reserveRatio: e.target.value })} /></Field>
          <Field label="每月繳費期限日"><input className="input" type="number" value={form.dueDay} onChange={(e) => setForm({ ...form, dueDay: e.target.value })} /></Field>
        </FormModal>
      )}
    </Page>
  );
}

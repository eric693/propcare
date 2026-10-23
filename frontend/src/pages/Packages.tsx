import { FormEvent, useState } from 'react';
import { PackageCheck, Plus } from 'lucide-react';
import api from '../api/client';
import { Page } from '../components/Layout';
import HowTo from '../components/HowTo';
import { act, Empty, ErrorBox, Field, FormModal, Loading, Tabs, toast, useLoad } from '../components/ui';
import { useAuth, useCanWrite } from '../context/AuthContext';
import { dt, L } from '../lib/format';
import { Unit } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const CARRIERS = ['黑貓宅急便', '新竹物流', '郵局', '嘉里大榮', '宅配通', '蝦皮店到家', '7-11 交貨便', '其他'];

export default function Packages() {
  const { cid } = useAuth();
  const canWrite = useCanWrite();
  const [status, setStatus] = useState<'WAITING' | 'PICKED' | 'ALL'>('WAITING');
  const [q, setQ] = useState('');
  const { data, error, reload } = useLoad(() => api.get<any[]>(`/packages?status=${status}&q=${encodeURIComponent(q)}`).then((r) => r.data), [cid, status, q]);
  const { data: community } = useLoad(() => api.get<any>('/community').then((r) => r.data), [cid]);
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState('');
  const overdueMs = (community?.packageOverdueDays ?? 7) * 86400000;

  async function pickup(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    try {
      const r = await api.post('/packages/pickup', { code: code.trim() });
      toast(`${r.data.package.unit.label} 已領取（${L.pkgKind[r.data.package.kind]}）`); setCode(''); reload();
    } catch (err: any) { toast(err.response?.data?.error ?? '找不到', true); }
  }

  return (
    <Page title="包裹代收" actions={canWrite && <button className="btn-primary" onClick={() => setAdding(true)}><Plus className="w-4 h-4" />登記包裹</button>}>
      <HowTo module="packages" />
      {canWrite && (
        <form onSubmit={pickup} className="card flex flex-wrap items-center gap-2 mb-4">
          <PackageCheck className="w-5 h-5 text-brand" />
          <span className="text-sm font-semibold">住戶領取</span>
          <input className="input w-40 text-lg tracking-widest font-mono" inputMode="numeric" placeholder="取件碼" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn-primary">領取</button>
        </form>
      )}
      <div className="flex flex-wrap gap-2 items-start">
        <Tabs value={status} onChange={setStatus} items={[['WAITING', '待領'], ['PICKED', '已領'], ['ALL', '全部']]} />
        <input className="input max-w-xs ml-auto" placeholder="搜尋戶別、收件人、單號" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ErrorBox error={error} />
      {!data ? <Loading /> : !data.length ? <Empty>{status === 'WAITING' ? '目前沒有待領包裹' : '沒有資料'}</Empty> : (
        <div className="card p-0 overflow-x-auto"><table className="tbl">
          <thead><tr><th>收件時間</th><th>戶別</th><th>類型</th><th>物流／單號</th><th>位置</th><th>取件碼</th><th>狀態</th><th /></tr></thead>
          <tbody>{data.map((p) => {
            const overdue = p.status === 'WAITING' && Date.now() - new Date(p.receivedAt).getTime() > overdueMs;
            return (
              <tr key={p.id}>
                <td className="whitespace-nowrap">{dt(p.receivedAt)}</td>
                <td className="font-semibold">{p.unit.label}{p.recipient && <div className="text-xs text-gray-400 font-normal">{p.recipient}</div>}</td>
                <td><span className={p.kind === 'COLD' ? 'badge-info' : p.kind === 'REGISTERED' ? 'badge-warn' : 'badge-mute'}>{L.pkgKind[p.kind]}</span></td>
                <td className="text-xs">{p.carrier}<div className="text-gray-400">{p.trackingNo}</div></td>
                <td>{p.shelf}</td>
                <td className="font-mono font-semibold tracking-wider">{p.pickupCode}</td>
                <td>{overdue ? <span className="badge-bad">逾期未領</span> : <span className={p.status === 'WAITING' ? 'badge-warn' : 'badge-ok'}>{L.pkgStatus[p.status]}</span>}
                  {p.pickedAt && <div className="text-[11px] text-gray-400">{dt(p.pickedAt)}</div>}
                  {p.notified && p.status === 'WAITING' && <div className="text-[11px] text-green-600">已 LINE 通知</div>}</td>
                <td className="text-right whitespace-nowrap">{canWrite && p.status === 'WAITING' && <>
                  <button className="btn-primary btn-sm" onClick={() => act(() => api.post('/packages/pickup', { id: p.id }), '已領取').then(reload)}>領取</button>
                  <button className="btn-ghost btn-sm" onClick={() => confirm('標記為退回寄件人？') && act(() => api.post(`/packages/${p.id}/return`), '已退回').then(reload)}>退回</button>
                </>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      {adding && <AddForm onClose={() => setAdding(false)} onSaved={reload} />}
    </Page>
  );
}

function AddForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { cid } = useAuth();
  const { data: units } = useLoad(() => api.get<Unit[]>('/units').then((r) => r.data), [cid]);
  const [f, setF] = useState({ unitId: '', recipient: '', carrier: CARRIERS[0], trackingNo: '', kind: 'PARCEL', shelf: '', count: '1', note: '' });
  const [q, setQ] = useState('');
  const matches = (units ?? []).filter((u) => q && (u.label.includes(q) || u.residents.some((r) => r.name.includes(q)))).slice(0, 8);
  const sel = units?.find((u) => u.id === f.unitId);
  return (
    <FormModal title="登記代收包裹" submitText="登記並通知" onClose={onClose} onSubmit={async () => {
      if (!f.unitId) throw { response: { data: { error: '請先選擇戶別' } } };
      const r = await api.post('/packages', { ...f, count: Number(f.count) });
      toast(`取件碼 ${r.data.packages.map((p: any) => p.pickupCode).join('、')}${r.data.notified ? '，已 LINE 通知住戶' : ''}`);
      onSaved();
    }}>
      <Field label="戶別（輸入戶號或姓名）" full>
        {sel ? <div className="flex items-center gap-2"><b>{sel.label}</b><span className="text-sm text-gray-500">{sel.residents.map((r) => r.name).join('、')}</span><button type="button" className="btn-ghost btn-sm ml-auto" onClick={() => { setF({ ...f, unitId: '' }); setQ(''); }}>重選</button></div> : <>
          <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="例如 5F-1 或 王" />
          {matches.length > 0 && <div className="mt-1 border border-gray-100 rounded-xl divide-y">{matches.map((u) => (
            <button type="button" key={u.id} className="w-full text-left px-3 py-2 text-sm hover:bg-brand-50" onClick={() => setF({ ...f, unitId: u.id, recipient: u.residents[0]?.name ?? '' })}>
              <b>{u.label}</b> <span className="text-gray-500">{u.residents.map((r) => r.name).join('、')}</span></button>
          ))}</div>}
        </>}
      </Field>
      <Field label="收件人"><input className="input" value={f.recipient} onChange={(e) => setF({ ...f, recipient: e.target.value })} /></Field>
      <Field label="類型"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(L.pkgKind).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="物流"><select className="input" value={f.carrier} onChange={(e) => setF({ ...f, carrier: e.target.value })}>{CARRIERS.map((c) => <option key={c}>{c}</option>)}</select></Field>
      <Field label="件數"><input className="input" type="number" min={1} max={20} value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} /></Field>
      <Field label="單號（選填）"><input className="input" value={f.trackingNo} onChange={(e) => setF({ ...f, trackingNo: e.target.value })} /></Field>
      <Field label="放置位置"><input className="input" placeholder="A-3" value={f.shelf} onChange={(e) => setF({ ...f, shelf: e.target.value })} /></Field>
    </FormModal>
  );
}

import { useState } from 'react';
import { Download, Plus, Trash2 } from 'lucide-react';
import api from '../api/client';
import { Page } from '../components/Layout';
import HowTo from '../components/HowTo';
import { act, Empty, ErrorBox, Field, Filter, FormModal, Loading, matches, SearchBox, Stat, Toolbar, useLoad } from '../components/ui';
import { useAuth, useCanWrite } from '../context/AuthContext';
import { d10, downloadCsv, L, money } from '../lib/format';
import { logExport } from '../lib/exportLog';

/* eslint-disable @typescript-eslint/no-explicit-any */
const CATS = ['設備', '消防', '機電', '監視門禁', '家具', '健身器材', '清潔工具', '電腦文具', '其他'];
const statusCls: Record<string, string> = { IN_USE: 'badge-ok', REPAIR: 'badge-warn', IDLE: 'badge-mute', SCRAPPED: 'badge-bad' };

export default function Assets() {
  const { cid } = useAuth();
  const canWrite = useCanWrite();
  const { data, error, reload } = useLoad(() => api.get<any[]>('/assets').then((r) => r.data), [cid]);
  const [edit, setEdit] = useState<any>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [status, setStatus] = useState('');
  const all = data ?? [];
  const list = all.filter((a) => (!cat || a.category === cat) && (!status || a.status === status) && matches(q, a.assetNo, a.name, a.location, a.keeper, a.note));
  const live = all.filter((a) => a.status !== 'SCRAPPED');
  return (
    <Page title="財產清冊" actions={canWrite && <button className="btn-primary" onClick={() => setEdit({})}><Plus className="w-4 h-4" />新增財產</button>}>
      <HowTo module="assets" />
      {data && <div className="grid grid-cols-3 gap-3 mb-3">
        <Stat label="財產項目" value={live.length} sub={`共 ${live.reduce((s, a) => s + a.quantity, 0)} 件`} />
        <Stat label="購置金額合計" value={money(live.reduce((s, a) => s + a.cost, 0))} />
        <Stat label="維修中" value={all.filter((a) => a.status === 'REPAIR').length} tone={all.some((a) => a.status === 'REPAIR') ? 'warn' : undefined} />
      </div>}
      <Toolbar count={data && `顯示 ${list.length} / ${all.length} 項`}>
        <SearchBox value={q} onChange={setQ} placeholder="搜尋編號、名稱、位置、保管人" />
        <Filter value={cat} onChange={setCat} all="全部類別" options={[...new Set([...CATS, ...all.map((a) => a.category)])].map((c) => [c, c])} />
        <Filter value={status} onChange={setStatus} all="全部狀態" options={L.assetStatus} />
        <button className="btn-secondary" disabled={!list.length} onClick={() => downloadCsv('財產清冊', ['財產編號', '名稱', '類別', '位置', '數量', '購置日', '購置金額', '狀態', '保管人', '備註'],
          list.map((a) => [a.assetNo, a.name, a.category, a.location, a.quantity, d10(a.purchaseDate), a.cost, L.assetStatus[a.status], a.keeper, a.note]), logExport)}><Download className="w-4 h-4" />匯出 Excel</button>
      </Toolbar>
      <ErrorBox error={error} />
      {!data ? <Loading /> : !list.length ? <Empty>{all.length ? '沒有符合條件的財產' : '還沒有財產資料。改選管委會時，財產清冊是移交的重點（條例第 20 條）。'}</Empty> : (
        <div className="card p-0 overflow-x-auto"><table className="tbl">
          <thead><tr><th>編號</th><th>名稱</th><th>類別</th><th>位置</th><th className="text-right">數量</th><th>購置日</th><th className="text-right">金額</th><th>狀態</th><th>保管人</th><th /></tr></thead>
          <tbody>{list.map((a) => (
            <tr key={a.id} className={a.status === 'SCRAPPED' ? 'opacity-50' : ''}>
              <td className="font-mono text-xs">{a.assetNo}</td><td className="font-semibold">{a.name}{a.note && <div className="text-xs text-gray-400 font-normal">{a.note}</div>}</td>
              <td>{a.category}</td><td className="text-gray-500">{a.location}</td><td className="num text-right">{a.quantity}</td>
              <td className="whitespace-nowrap">{d10(a.purchaseDate)}</td><td className="num text-right">{money(a.cost)}</td>
              <td><span className={statusCls[a.status]}>{L.assetStatus[a.status]}</span></td><td>{a.keeper}</td>
              <td className="text-right whitespace-nowrap">
                {canWrite && <button className="btn-ghost btn-sm" onClick={() => setEdit(a)}>編輯</button>}
                {canWrite && <button className="btn-ghost btn-sm text-gray-400" onClick={() => confirm(`刪除「${a.name}」？報廢請改狀態以保留紀錄。`) && act(() => api.delete(`/assets/${a.id}`), '已刪除').then(reload)}><Trash2 className="w-3.5 h-3.5" /></button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {edit && <AssetForm a={edit} onClose={() => setEdit(null)} onSaved={reload} />}
    </Page>
  );
}

function AssetForm({ a, onClose, onSaved }: { a: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ assetNo: a.assetNo ?? '', name: a.name ?? '', category: a.category ?? '設備', location: a.location ?? '', quantity: String(a.quantity ?? 1), purchaseDate: d10(a.purchaseDate), cost: String(a.cost ?? 0), status: a.status ?? 'IN_USE', keeper: a.keeper ?? '', note: a.note ?? '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <FormModal title={a.id ? '編輯財產' : '新增財產'} onClose={onClose} onSubmit={async () => {
      const body = { ...f, quantity: Number(f.quantity), cost: Number(f.cost) };
      if (a.id) await api.put(`/assets/${a.id}`, body); else await api.post('/assets', body);
      onSaved();
    }}>
      <Field label="財產名稱"><input className="input" autoFocus value={f.name} onChange={set('name')} /></Field>
      <Field label="財產編號"><input className="input" value={f.assetNo} onChange={set('assetNo')} /></Field>
      <Field label="類別"><select className="input" value={f.category} onChange={set('category')}>{[...new Set([...CATS, f.category])].map((c) => <option key={c}>{c}</option>)}</select></Field>
      <Field label="放置位置"><input className="input" value={f.location} onChange={set('location')} /></Field>
      <Field label="數量"><input className="input" type="number" min={0} value={f.quantity} onChange={set('quantity')} /></Field>
      <Field label="購置日"><input className="input" type="date" value={f.purchaseDate} onChange={set('purchaseDate')} /></Field>
      <Field label="購置金額"><input className="input" type="number" min={0} value={f.cost} onChange={set('cost')} /></Field>
      <Field label="狀態"><select className="input" value={f.status} onChange={set('status')}>{Object.entries(L.assetStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="保管人"><input className="input" value={f.keeper} onChange={set('keeper')} /></Field>
      <Field label="備註"><input className="input" value={f.note} onChange={set('note')} /></Field>
    </FormModal>
  );
}

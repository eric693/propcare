import { useState } from 'react';
import { Plus } from 'lucide-react';
import api from '../api/client';
import { Page } from '../components/Layout';
import HowTo from '../components/HowTo';
import { act, Empty, ErrorBox, Field, Filter, FormModal, Loading, matches, SearchBox, Tabs, Toolbar, useLoad } from '../components/ui';
import { useAuth, useCanWrite } from '../context/AuthContext';
import { dt, L, money } from '../lib/format';
import { Unit } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const CATS = ['水電', '電梯', '門禁對講', '消防', '照明', '漏水', '公設損壞', '清潔環境', '停車場', '其他'];

export default function Repairs() {
  const { cid } = useAuth();
  const canWrite = useCanWrite();
  const [status, setStatus] = useState('OPEN');
  const { data, error, reload } = useLoad(() => api.get<any[]>(`/repairs?status=${status}`).then((r) => r.data), [cid, status]);
  const [adding, setAdding] = useState<any>(null);
  const [handle, setHandle] = useState<any>(null);
  const [q, setQ] = useState('');
  const [pri, setPri] = useState('');
  const [cat, setCat] = useState('');
  const [area, setArea] = useState('');
  const list = (data ?? []).filter((r) => (!pri || r.priority === pri) && (!cat || r.category === cat) && (!area || r.area === area)
    && matches(q, r.repairNo, r.title, r.description, r.location, r.unit?.label, r.resident?.name, r.vendor?.name, r.assignee));
  return (
    <Page title="報修" actions={canWrite && <button className="btn-primary" onClick={() => setAdding({})}><Plus className="w-4 h-4" />登記報修</button>}>
      <HowTo module="repairs" />
      <Tabs value={status} onChange={setStatus} items={[['OPEN', '處理中'], ['DONE', '已完工'], ['CLOSED', '已結案'], ['ALL', '全部']]} />
      <Toolbar count={data && `顯示 ${list.length} / ${data.length} 筆`}>
        <SearchBox value={q} onChange={setQ} placeholder="搜尋單號、項目、位置、戶別、報修人、廠商" />
        <Filter value={pri} onChange={setPri} all="全部緊急程度" options={L.priority} />
        <Filter value={cat} onChange={setCat} all="全部類別" options={CATS.map((c) => [c, c])} />
        <Filter value={area} onChange={setArea} all="全部區域" options={L.area} />
      </Toolbar>
      <ErrorBox error={error} />
      {!data ? <Loading /> : !list.length ? <Empty>{data.length ? '沒有符合條件的報修' : '沒有報修'}</Empty> : (
        <div className="space-y-3">{list.map((r) => (
          <div key={r.id} className="card">
            <div className="flex flex-wrap items-center gap-2">
              <span className={L.priorityCls[r.priority]}>{L.priority[r.priority]}</span>
              <span className={L.repairCls[r.status]}>{L.repair[r.status]}</span>
              <span className="text-xs text-gray-400 font-mono">{r.repairNo}</span>
              <span className="text-xs text-gray-400">{dt(r.createdAt)}</span>
              {canWrite && <span className="ml-auto flex gap-1">
                <button className="btn-secondary btn-sm" onClick={() => setHandle(r)}>處理</button>
                <button className="btn-ghost btn-sm" onClick={() => setAdding(r)}>編輯</button>
                <button className="btn-ghost btn-sm text-red-500" onClick={() => confirm(`刪除報修 ${r.repairNo}「${r.title}」？處理紀錄會一併刪除。`) && act(() => api.delete(`/repairs/${r.id}`), '已刪除').then(reload)}>刪除</button>
              </span>}
            </div>
            <div className="font-semibold mt-1.5">{r.title}</div>
            <div className="text-sm text-gray-500">{[r.unit?.label, L.area[r.area], r.category, r.location].filter(Boolean).join('・')}</div>
            {r.description && <div className="text-sm text-gray-600 mt-1">{r.description}</div>}
            <div className="text-xs text-gray-500 mt-1">{r.resident && `報修人 ${r.resident.name} ${r.resident.phone}`}{r.vendor && `　廠商 ${r.vendor.name} ${r.vendor.phone}`}{r.assignee && `　${r.assignee}`}{r.cost > 0 && `　費用 ${money(r.cost)} 元`}</div>
            {r.logs.length > 0 && (
              <ol className="mt-2 border-l-2 border-gray-100 pl-3 space-y-1">{r.logs.map((l: any) => (
                <li key={l.id} className="text-xs text-gray-500"><span className="text-gray-400">{dt(l.createdAt)} {l.byName}</span>　{l.text}{!l.public && <span className="badge-mute ml-1">內部</span>}</li>
              ))}</ol>
            )}
          </div>
        ))}</div>
      )}
      {adding && <AddRepair r={adding} onClose={() => setAdding(null)} onSaved={reload} />}
      {handle && <Handle r={handle} onClose={() => setHandle(null)} onSaved={reload} />}
    </Page>
  );
}

function AddRepair({ r, onClose, onSaved }: { r: any; onClose: () => void; onSaved: () => void }) {
  const { cid } = useAuth();
  const { data: units } = useLoad(() => api.get<Unit[]>('/units').then((r) => r.data), [cid]);
  const [f, setF] = useState(r.id
    ? { unitId: r.unitId ?? '', area: r.area, location: r.location, category: r.category, title: r.title, description: r.description, priority: r.priority }
    : { unitId: '', area: 'PUBLIC', location: '', category: '水電', title: '', description: '', priority: 'NORMAL' });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <FormModal title={r.id ? `編輯報修 ${r.repairNo}` : '登記報修'} onClose={onClose} onSubmit={async () => {
      const body = { ...f, unitId: f.unitId || null };
      await (r.id ? api.put(`/repairs/${r.id}`, body) : api.post('/repairs', body)); onSaved();
    }}>
      <Field label="區域"><select className="input" value={f.area} onChange={set('area')}><option value="PUBLIC">公共區域</option><option value="PRIVATE">住戶室內</option></select></Field>
      <Field label="相關戶別（選填）"><select className="input" value={f.unitId} onChange={set('unitId')}><option value="">—</option>{(units ?? []).map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</select></Field>
      <Field label="類別"><select className="input" value={f.category} onChange={set('category')}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></Field>
      <Field label="緊急程度"><select className="input" value={f.priority} onChange={set('priority')}>{Object.entries(L.priority).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="位置" full><input className="input" placeholder="B 棟 3F 梯廳" value={f.location} onChange={set('location')} /></Field>
      <Field label="報修項目" full><input className="input" value={f.title} onChange={set('title')} /></Field>
      <Field label="說明" full><textarea className="input h-20" value={f.description} onChange={set('description')} /></Field>
    </FormModal>
  );
}

function Handle({ r, onClose, onSaved }: { r: any; onClose: () => void; onSaved: () => void }) {
  const { cid } = useAuth();
  const { data: vendors } = useLoad(() => api.get<any[]>('/vendors').then((x) => x.data), [cid]);
  const [f, setF] = useState({ status: r.status, vendorId: r.vendorId ?? '', assignee: r.assignee, cost: String(r.cost), priority: r.priority, log: '', logPublic: true });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <FormModal title={`處理報修 ${r.repairNo}`} onClose={onClose} onSubmit={async () => {
      await api.put(`/repairs/${r.id}`, { ...f, cost: Number(f.cost), vendorId: f.vendorId || null, log: f.log || undefined }); onSaved();
    }}>
      <div className="sm:col-span-2 text-sm bg-gray-50 rounded-xl p-3"><b>{r.title}</b>　{r.unit?.label ?? '公共區域'} {r.location}</div>
      <Field label="狀態"><select className="input" value={f.status} onChange={set('status')}>{Object.entries(L.repair).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="緊急程度"><select className="input" value={f.priority} onChange={set('priority')}>{Object.entries(L.priority).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="派工廠商"><select className="input" value={f.vendorId} onChange={set('vendorId')}><option value="">—</option>{(vendors ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}（{v.kind}）</option>)}</select></Field>
      <Field label="負責人／師傅"><input className="input" value={f.assignee} onChange={set('assignee')} /></Field>
      <Field label="費用"><input className="input" type="number" value={f.cost} onChange={set('cost')} /></Field>
      <Field label="處理說明" full><textarea className="input h-20" value={f.log} onChange={set('log')} placeholder="例如：已更換燈管，恢復正常" /></Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={!f.logPublic} onChange={(e) => setF({ ...f, logPublic: !e.target.checked })} />僅內部紀錄（住戶看不到，也不發通知）</label>
    </FormModal>
  );
}

import { useState } from 'react';
import { Download, LogOut, Plus, Trash2 } from 'lucide-react';
import api from '../api/client';
import { Page } from '../components/Layout';
import HowTo from '../components/HowTo';
import { act, Empty, ErrorBox, Field, Filter, FormModal, Loading, matches, SearchBox, Stat, Tabs, toast, Toolbar, useLoad } from '../components/ui';
import { useAuth, useCanWrite } from '../context/AuthContext';
import { addDays, downloadCsv, dt, today } from '../lib/format';
import { Unit } from '../types';
import { logExport } from '../lib/exportLog';

/* eslint-disable @typescript-eslint/no-explicit-any */
const PURPOSES = ['拜訪', '外送', '廠商施工', '看屋', '快遞', '其他'];

export default function Visitors() {
  const { cid } = useAuth();
  const canWrite = useCanWrite();
  const [tab, setTab] = useState<'inside' | 'history'>('inside');
  const [from, setFrom] = useState(addDays(today(), -6));
  const [to, setTo] = useState(today());
  const { data, error, reload } = useLoad(() => api.get<any[]>(tab === 'inside' ? '/visitors?inside=1' : `/visitors?from=${from}&to=${to}`).then((r) => r.data), [cid, tab, from, to]);
  const [edit, setEdit] = useState<any>(null);
  const [q, setQ] = useState('');
  const [purpose, setPurpose] = useState('');
  const all = data ?? [];
  const list = all.filter((v) => (!purpose || v.purpose === purpose) && matches(q, v.name, v.phone, v.plate, v.badge, v.unit?.label, v.note));
  const people = all.reduce((s, v) => s + v.headcount, 0);
  return (
    <Page title="訪客登記" actions={canWrite && <button className="btn-primary" onClick={() => setEdit({})}><Plus className="w-4 h-4" />登記訪客</button>}>
      <HowTo module="visitors" />
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={tab} onChange={setTab} items={[['inside', '目前在場'], ['history', '來訪紀錄']]} />
        {tab === 'history' && <div className="flex items-center gap-1 ml-auto mb-4">
          <input className="input w-auto" type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />～
          <input className="input w-auto" type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </div>}
      </div>
      {tab === 'inside' && data && <div className="grid grid-cols-2 gap-3 mb-3"><Stat label="在場組數" value={all.length} /><Stat label="在場人數" value={people} /></div>}
      <Toolbar count={data && `顯示 ${list.length} / ${all.length} 筆`}>
        <SearchBox value={q} onChange={setQ} placeholder="搜尋姓名、電話、車牌、戶別" />
        <Filter value={purpose} onChange={setPurpose} all="全部事由" options={PURPOSES.map((p) => [p, p])} />
        {tab === 'history' && <button className="btn-secondary" disabled={!list.length} onClick={() => downloadCsv('訪客紀錄', ['進入時間', '離開時間', '訪客', '電話', '人數', '拜訪戶別', '事由', '車牌', '換證號', '登記人', '備註'],
          list.map((v) => [dt(v.inAt), v.outAt ? dt(v.outAt) : '', v.name, v.phone, v.headcount, v.unit?.label ?? '', v.purpose, v.plate, v.badge, v.createdBy, v.note]), logExport)}><Download className="w-4 h-4" />匯出 Excel</button>}
      </Toolbar>
      <ErrorBox error={error} />
      {!data ? <Loading /> : !list.length ? <Empty>{tab === 'inside' ? '目前沒有在場的訪客' : '這段期間沒有訪客紀錄'}</Empty> : (
        <div className="card p-0 overflow-x-auto"><table className="tbl">
          <thead><tr><th>進入</th><th>訪客</th><th>拜訪戶別</th><th>事由</th><th>車牌／換證</th><th>離開</th><th /></tr></thead>
          <tbody>{list.map((v) => (
            <tr key={v.id}>
              <td className="whitespace-nowrap">{dt(v.inAt)}</td>
              <td><b>{v.name}</b>{v.headcount > 1 && <span className="text-gray-500"> 等 {v.headcount} 人</span>}<div className="text-xs text-gray-400">{v.phone}</div></td>
              <td>{v.unit?.label ?? <span className="text-gray-400">公共區域</span>}</td>
              <td><span className="badge-mute">{v.purpose}</span>{v.note && <div className="text-xs text-gray-400">{v.note}</div>}</td>
              <td className="text-xs">{v.plate}<div className="text-gray-400">{v.badge}</div></td>
              <td className="whitespace-nowrap">{v.outAt ? dt(v.outAt) : <span className="badge-warn">在場</span>}</td>
              <td className="text-right whitespace-nowrap">
                {canWrite && !v.outAt && <button className="btn-primary btn-sm" onClick={() => act(() => api.post(`/visitors/${v.id}/leave`), `${v.name} 已離開`).then(reload)}><LogOut className="w-3.5 h-3.5" />離開</button>}
                {canWrite && <button className="btn-ghost btn-sm" onClick={() => setEdit(v)}>編輯</button>}
                {canWrite && <button className="btn-ghost btn-sm text-gray-400" onClick={() => confirm(`刪除 ${v.name} 的來訪紀錄？`) && act(() => api.delete(`/visitors/${v.id}`), '已刪除').then(reload)}><Trash2 className="w-3.5 h-3.5" /></button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {edit && <VisitorForm v={edit} onClose={() => setEdit(null)} onSaved={reload} />}
    </Page>
  );
}

function VisitorForm({ v, onClose, onSaved }: { v: any; onClose: () => void; onSaved: () => void }) {
  const { cid } = useAuth();
  const { data: units } = useLoad(() => api.get<Unit[]>('/units').then((r) => r.data), [cid]);
  const [f, setF] = useState({ unitId: v.unitId ?? '', name: v.name ?? '', phone: v.phone ?? '', purpose: v.purpose ?? '拜訪', headcount: String(v.headcount ?? 1), plate: v.plate ?? '', badge: v.badge ?? '', note: v.note ?? '' });
  return (
    <FormModal title={v.id ? '編輯訪客' : '登記訪客'} submitText={v.id ? '儲存' : '登記'} onClose={onClose} onSubmit={async () => {
      const body = { ...f, unitId: f.unitId || null, headcount: Number(f.headcount) };
      if (v.id) await api.put(`/visitors/${v.id}`, body); else { await api.post('/visitors', body); toast('已登記，並通知受訪戶'); }
      onSaved();
    }}>
      <Field label="訪客姓名"><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="電話"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      <Field label="拜訪戶別"><select className="input" value={f.unitId} onChange={(e) => setF({ ...f, unitId: e.target.value })}><option value="">公共區域／不指定</option>{(units ?? []).map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</select></Field>
      <Field label="事由"><select className="input" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })}>{PURPOSES.map((p) => <option key={p}>{p}</option>)}</select></Field>
      <Field label="人數"><input className="input" type="number" min={1} value={f.headcount} onChange={(e) => setF({ ...f, headcount: e.target.value })} /></Field>
      <Field label="車牌"><input className="input" value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value.toUpperCase() })} /></Field>
      <Field label="換證／臨停證號"><input className="input" value={f.badge} onChange={(e) => setF({ ...f, badge: e.target.value })} /></Field>
      <Field label="備註"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      <p className="text-xs text-gray-400 sm:col-span-2">依個資法，訪客資料僅供社區門禁安全使用，請勿另作他用。</p>
    </FormModal>
  );
}

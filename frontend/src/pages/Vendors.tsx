import { useState } from 'react';
import { CheckCircle2, Plus } from 'lucide-react';
import api from '../api/client';
import { Page } from '../components/Layout';
import HowTo from '../components/HowTo';
import { act, Empty, ErrorBox, Field, Filter, FormModal, Loading, matches, SearchBox, Tabs, toast, Toolbar, useLoad } from '../components/ui';
import { useAuth, useCanWrite } from '../context/AuthContext';
import { d10, daysFrom, money, today } from '../lib/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
const KINDS = ['清潔', '保全', '電梯', '消防', '機電', '水電', '園藝', '機械停車', '病媒防治', '其他'];

export default function Vendors() {
  const [tab, setTab] = useState<'inspections' | 'contracts' | 'vendors'>('inspections');
  return (
    <Page title="廠商、合約與法定檢查">
      <HowTo module="vendors" />
      <Tabs value={tab} onChange={setTab} items={[['inspections', '法定檢查與保養'], ['contracts', '合約'], ['vendors', '廠商']]} />
      {tab === 'inspections' ? <Inspections /> : tab === 'contracts' ? <Contracts /> : <VendorList />}
    </Page>
  );
}

function useVendors() {
  const { cid } = useAuth();
  return useLoad(() => api.get<any[]>('/vendors').then((r) => r.data), [cid]);
}

function Inspections() {
  const { cid } = useAuth();
  const canWrite = useCanWrite();
  const { data, error, reload } = useLoad(() => api.get<any[]>('/inspections').then((r) => r.data), [cid]);
  const { data: vendors } = useVendors();
  const [edit, setEdit] = useState<any>(null);
  const [done, setDone] = useState<any>(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [st, setSt] = useState('PENDING');
  const [due, setDue] = useState('');
  const list = (data ?? []).filter((i) => (!st || i.status === st) && (!kind || i.kind === kind)
    && (!due || (due === 'overdue' ? i.status === 'PENDING' && daysFrom(i.dueDate) < 0 : i.status === 'PENDING' && daysFrom(i.dueDate) <= Number(due)))
    && matches(q, i.title, i.kind, i.note, i.result, i.vendor?.name));
  const kinds = [...new Set((data ?? []).map((i) => i.kind))].sort();
  return (
    <>
      <Toolbar count={data && `顯示 ${list.length} 項`}>
        <SearchBox value={q} onChange={setQ} placeholder="搜尋項目、備註、結果、廠商" />
        <Filter value={kind} onChange={setKind} all="全部類別" options={kinds.map((k) => [k, k])} />
        <Filter value={st} onChange={setSt} all="全部狀態" options={[['PENDING', '待辦'], ['DONE', '已完成'], ['SKIPPED', '略過']]} />
        <Filter value={due} onChange={setDue} all="不限期限" options={[['overdue', '已逾期'], ['30', '30 天內到期'], ['90', '90 天內到期']]} />
        {canWrite && <button className="btn-primary" onClick={() => setEdit({ cycleMonths: 12, dueDate: today(), kind: '其他' })}><Plus className="w-4 h-4" />新增項目</button>}
      </Toolbar>
      <ErrorBox error={error} />
      {!data ? <Loading /> : !list.length ? <Empty>沒有符合條件的項目</Empty> : (
        <div className="card p-0 overflow-x-auto"><table className="tbl">
          <thead><tr><th>項目</th><th>期限</th><th>週期</th><th>廠商</th><th>狀態</th><th /></tr></thead>
          <tbody>{list.map((i) => {
            const left = daysFrom(i.dueDate);
            return (
              <tr key={i.id} className={i.status !== 'PENDING' ? 'opacity-60' : ''}>
                <td><span className="badge-mute mr-1.5">{i.kind}</span><b>{i.title}</b>{i.note && <div className="text-xs text-gray-400 mt-0.5 max-w-md whitespace-normal">{i.note}</div>}</td>
                <td className="whitespace-nowrap">{d10(i.dueDate)}</td>
                <td>{i.cycleMonths ? `每 ${i.cycleMonths} 個月` : '單次'}</td>
                <td>{i.vendor?.name ?? '-'}</td>
                <td>{i.status === 'PENDING'
                  ? <span className={left < 0 ? 'badge-bad' : left <= 30 ? 'badge-warn' : 'badge-mute'}>{left < 0 ? `逾期 ${-left} 天` : `${left} 天後`}</span>
                  : <span className="badge-ok">{i.status === 'DONE' ? '已完成' : '略過'} {d10(i.doneDate)}</span>}
                  {i.result && <div className="text-xs text-gray-400">{i.result}</div>}</td>
                <td className="text-right whitespace-nowrap">{canWrite && <>
                  {i.status === 'PENDING' && <button className="btn-primary btn-sm" onClick={() => setDone(i)}><CheckCircle2 className="w-3.5 h-3.5" />完成</button>}
                  <button className="btn-ghost btn-sm" onClick={() => setEdit({ ...i, dueDate: d10(i.dueDate), vendorId: i.vendorId ?? '' })}>編輯</button>
                  <button className="btn-ghost btn-sm text-red-500" onClick={() => confirm(`刪除「${i.title}」（期限 ${d10(i.dueDate)}）？`) && act(() => api.delete(`/inspections/${i.id}`), '已刪除').then(reload)}>刪除</button>
                </>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      {edit && (
        <FormModal title={edit.id ? '編輯項目' : '新增檢查／保養項目'} onClose={() => setEdit(null)} onSubmit={async () => {
          const body = { kind: edit.kind, title: edit.title, dueDate: edit.dueDate, cycleMonths: Number(edit.cycleMonths), vendorId: edit.vendorId || null, note: edit.note ?? '' };
          await (edit.id ? api.put(`/inspections/${edit.id}`, body) : api.post('/inspections', body)); reload();
        }}>
          <Field label="項目名稱" full><input className="input" value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
          <Field label="類別"><input className="input" list="ins-kinds" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })} /><datalist id="ins-kinds">{['消防', '建管', '電梯', '機械停車', '給水', '環境', '其他'].map((k) => <option key={k} value={k} />)}</datalist></Field>
          <Field label="期限"><input className="input" type="date" value={edit.dueDate} onChange={(e) => setEdit({ ...edit, dueDate: e.target.value })} /></Field>
          <Field label="週期（月；0＝單次）"><input className="input" type="number" value={edit.cycleMonths} onChange={(e) => setEdit({ ...edit, cycleMonths: e.target.value })} /></Field>
          <Field label="廠商"><select className="input" value={edit.vendorId ?? ''} onChange={(e) => setEdit({ ...edit, vendorId: e.target.value })}><option value="">—</option>{(vendors ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
          <Field label="備註" full><textarea className="input h-20" value={edit.note ?? ''} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></Field>
        </FormModal>
      )}
      {done && <DoneForm i={done} onClose={() => setDone(null)} onSaved={reload} />}
    </>
  );
}

function DoneForm({ i, onClose, onSaved }: { i: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ doneDate: today(), result: '', skip: false });
  return (
    <FormModal title={`完成：${i.title}`} submitText="登錄" onClose={onClose} onSubmit={async () => {
      const r = await api.post(`/inspections/${i.id}/complete`, f);
      toast(r.data.next ? `已登錄，下次期限 ${r.data.next}` : '已登錄'); onSaved();
    }}>
      <Field label="完成日"><input className="input" type="date" value={f.doneDate} onChange={(e) => setF({ ...f, doneDate: e.target.value })} /></Field>
      <label className="flex items-center gap-2 text-sm self-end pb-2"><input type="checkbox" checked={f.skip} onChange={(e) => setF({ ...f, skip: e.target.checked })} />本期不適用（略過）</label>
      <Field label="結果／申報文號" full><textarea className="input h-20" value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })} placeholder="例如：合格，消防局收件字號…" /></Field>
      {i.cycleMonths > 0 && <p className="text-xs text-gray-400 sm:col-span-2">登錄後會依週期自動排出下一次（{i.cycleMonths} 個月後）。</p>}
    </FormModal>
  );
}

function Contracts() {
  const { cid } = useAuth();
  const canWrite = useCanWrite();
  const { data, error, reload } = useLoad(() => api.get<any[]>('/contracts').then((r) => r.data), [cid]);
  const { data: vendors } = useVendors();
  const [edit, setEdit] = useState<any>(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [due, setDue] = useState('');
  const list = (data ?? []).filter((k) => (!kind || k.kind === kind)
    && (!due || (due === 'expired' ? k.daysLeft != null && k.daysLeft < 0 : due === 'soon' ? k.daysLeft != null && k.daysLeft >= 0 && k.daysLeft <= k.notifyDays : true))
    && matches(q, k.title, k.vendor?.name, k.note, k.kind));
  return (
    <>
      <Toolbar count={data && `顯示 ${list.length} / ${data.length} 份`}>
        <SearchBox value={q} onChange={setQ} placeholder="搜尋合約名稱、廠商、備註" />
        <Filter value={kind} onChange={setKind} all="全部類別" options={KINDS.map((k) => [k, k])} />
        <Filter value={due} onChange={setDue} all="不限到期" options={[['soon', '即將到期'], ['expired', '已到期']]} />
        {canWrite && <button className="btn-primary" onClick={() => setEdit({ kind: '其他', notifyDays: 60 })}><Plus className="w-4 h-4" />新增合約</button>}
      </Toolbar>
      <ErrorBox error={error} />
      {!data ? <Loading /> : !list.length ? <Empty>{data.length ? '沒有符合條件的合約' : '沒有合約'}</Empty> : (
        <div className="card p-0 overflow-x-auto"><table className="tbl">
          <thead><tr><th>合約</th><th>廠商</th><th className="text-right">月費</th><th>期間</th><th>到期</th><th /></tr></thead>
          <tbody>{list.map((k) => (
            <tr key={k.id}>
              <td><b>{k.title}</b><div className="text-xs text-gray-400">{k.kind}</div></td><td>{k.vendor?.name ?? '-'}</td>
              <td className="num text-right">{money(k.monthlyAmount)}</td><td className="text-xs whitespace-nowrap">{d10(k.startDate)} ～ {d10(k.endDate)}</td>
              <td>{k.daysLeft == null ? '-' : <span className={k.daysLeft < 0 ? 'badge-bad' : k.daysLeft <= k.notifyDays ? 'badge-warn' : 'badge-mute'}>{k.daysLeft < 0 ? '已到期' : `${k.daysLeft} 天`}</span>}</td>
              <td className="text-right whitespace-nowrap">{canWrite && <>
                <button className="btn-ghost btn-sm" onClick={() => setEdit({ ...k, startDate: d10(k.startDate), endDate: d10(k.endDate), vendorId: k.vendorId ?? '' })}>編輯</button>
                <button className="btn-ghost btn-sm text-red-500" onClick={() => confirm(`刪除合約「${k.title}」？`) && act(() => api.delete(`/contracts/${k.id}`), '已刪除').then(reload)}>刪除</button>
              </>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {edit && (
        <FormModal title={edit.id ? '編輯合約' : '新增合約'} onClose={() => setEdit(null)} onSubmit={async () => {
          const body = { title: edit.title, kind: edit.kind, vendorId: edit.vendorId || null, monthlyAmount: Number(edit.monthlyAmount ?? 0), startDate: edit.startDate ?? '', endDate: edit.endDate ?? '', notifyDays: Number(edit.notifyDays), note: edit.note ?? '' };
          await (edit.id ? api.put(`/contracts/${edit.id}`, body) : api.post('/contracts', body)); reload();
        }}>
          <Field label="合約名稱" full><input className="input" value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
          <Field label="類別"><select className="input" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></Field>
          <Field label="廠商"><select className="input" value={edit.vendorId ?? ''} onChange={(e) => setEdit({ ...edit, vendorId: e.target.value })}><option value="">—</option>{(vendors ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
          <Field label="月費"><input className="input" type="number" value={edit.monthlyAmount ?? ''} onChange={(e) => setEdit({ ...edit, monthlyAmount: e.target.value })} /></Field>
          <Field label="到期前幾天提醒"><input className="input" type="number" value={edit.notifyDays} onChange={(e) => setEdit({ ...edit, notifyDays: e.target.value })} /></Field>
          <Field label="開始日"><input className="input" type="date" value={edit.startDate ?? ''} onChange={(e) => setEdit({ ...edit, startDate: e.target.value })} /></Field>
          <Field label="到期日"><input className="input" type="date" value={edit.endDate ?? ''} onChange={(e) => setEdit({ ...edit, endDate: e.target.value })} /></Field>
          <Field label="備註" full><textarea className="input h-16" value={edit.note ?? ''} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></Field>
          
        </FormModal>
      )}
    </>
  );
}

function VendorList() {
  const canWrite = useCanWrite();
  const { data, error, reload } = useVendors();
  const [edit, setEdit] = useState<any>(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const list = (data ?? []).filter((v) => (!kind || v.kind === kind) && matches(q, v.name, v.contact, v.phone, v.taxId, v.note));
  return (
    <>
      <Toolbar count={data && `顯示 ${list.length} / ${data.length} 家`}>
        <SearchBox value={q} onChange={setQ} placeholder="搜尋名稱、聯絡人、電話、統編" />
        <Filter value={kind} onChange={setKind} all="全部類別" options={KINDS.map((k) => [k, k])} />
        {canWrite && <button className="btn-primary" onClick={() => setEdit({ kind: '其他' })}><Plus className="w-4 h-4" />新增廠商</button>}
      </Toolbar>
      <ErrorBox error={error} />
      {!data ? <Loading /> : !list.length ? <Empty>{data.length ? '沒有符合條件的廠商' : '沒有廠商'}</Empty> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{list.map((v) => (
          <div key={v.id} className="card">
            <div className="flex items-center gap-2"><span className="badge-mute">{v.kind}</span><b>{v.name}</b>{canWrite && <span className="ml-auto flex">
              <button className="btn-ghost btn-sm" onClick={() => setEdit(v)}>編輯</button>
              <button className="btn-ghost btn-sm text-red-500" onClick={() => confirm(`刪除廠商「${v.name}」？`) && act(() => api.delete(`/vendors/${v.id}`), '已刪除').then(reload)}>刪除</button>
            </span>}</div>
            <div className="text-sm text-gray-500 mt-1">{v.contact} {v.phone && <a className="text-brand" href={`tel:${v.phone}`}>{v.phone}</a>}</div>
            {v.taxId && <div className="text-xs text-gray-400">統編 {v.taxId}</div>}
            {v.note && <div className="text-xs text-gray-400 mt-1">{v.note}</div>}
          </div>
        ))}</div>
      )}
      {edit && (
        <FormModal title={edit.id ? '編輯廠商' : '新增廠商'} onClose={() => setEdit(null)} onSubmit={async () => {
          const body = { name: edit.name, kind: edit.kind, contact: edit.contact ?? '', phone: edit.phone ?? '', taxId: edit.taxId ?? '', note: edit.note ?? '' };
          await (edit.id ? api.put(`/vendors/${edit.id}`, body) : api.post('/vendors', body)); reload();
        }}>
          <Field label="名稱" full><input className="input" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="類別"><select className="input" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></Field>
          <Field label="統一編號"><input className="input" value={edit.taxId ?? ''} onChange={(e) => setEdit({ ...edit, taxId: e.target.value })} /></Field>
          <Field label="聯絡人"><input className="input" value={edit.contact ?? ''} onChange={(e) => setEdit({ ...edit, contact: e.target.value })} /></Field>
          <Field label="電話"><input className="input" value={edit.phone ?? ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
          <Field label="備註" full><input className="input" value={edit.note ?? ''} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></Field>
          
        </FormModal>
      )}
    </>
  );
}

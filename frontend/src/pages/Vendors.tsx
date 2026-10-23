import { useState } from 'react';
import { CheckCircle2, Plus } from 'lucide-react';
import api from '../api/client';
import { Page } from '../components/Layout';
import HowTo from '../components/HowTo';
import { act, Empty, ErrorBox, Field, FormModal, Loading, Tabs, toast, useLoad } from '../components/ui';
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
  const [showHistory, setShowHistory] = useState(false);
  const list = (data ?? []).filter((i) => showHistory || i.status === 'PENDING');
  return (
    <>
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={showHistory} onChange={(e) => setShowHistory(e.target.checked)} />顯示已完成紀錄</label>
        {canWrite && <button className="btn-primary ml-auto" onClick={() => setEdit({ cycleMonths: 12, dueDate: today(), kind: '其他' })}><Plus className="w-4 h-4" />新增項目</button>}
      </div>
      <ErrorBox error={error} />
      {!data ? <Loading /> : !list.length ? <Empty>沒有項目</Empty> : (
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
                <td className="text-right whitespace-nowrap">{canWrite && i.status === 'PENDING' && <>
                  <button className="btn-primary btn-sm" onClick={() => setDone(i)}><CheckCircle2 className="w-3.5 h-3.5" />完成</button>
                  <button className="btn-ghost btn-sm" onClick={() => setEdit({ ...i, dueDate: d10(i.dueDate), vendorId: i.vendorId ?? '' })}>編輯</button>
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
          {edit.id && <div className="sm:col-span-2"><button className="btn-danger btn-sm" onClick={async () => { if (confirm('刪除這個項目？') && await act(() => api.delete(`/inspections/${edit.id}`), '已刪除')) { setEdit(null); reload(); } }}>刪除</button></div>}
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
  return (
    <>
      {canWrite && <button className="btn-primary mb-3" onClick={() => setEdit({ kind: '其他', notifyDays: 60 })}><Plus className="w-4 h-4" />新增合約</button>}
      <ErrorBox error={error} />
      {!data ? <Loading /> : !data.length ? <Empty>沒有合約</Empty> : (
        <div className="card p-0 overflow-x-auto"><table className="tbl">
          <thead><tr><th>合約</th><th>廠商</th><th className="text-right">月費</th><th>期間</th><th>到期</th><th /></tr></thead>
          <tbody>{data.map((k) => (
            <tr key={k.id}>
              <td><b>{k.title}</b><div className="text-xs text-gray-400">{k.kind}</div></td><td>{k.vendor?.name ?? '-'}</td>
              <td className="num text-right">{money(k.monthlyAmount)}</td><td className="text-xs whitespace-nowrap">{d10(k.startDate)} ～ {d10(k.endDate)}</td>
              <td>{k.daysLeft == null ? '-' : <span className={k.daysLeft < 0 ? 'badge-bad' : k.daysLeft <= k.notifyDays ? 'badge-warn' : 'badge-mute'}>{k.daysLeft < 0 ? '已到期' : `${k.daysLeft} 天`}</span>}</td>
              <td className="text-right">{canWrite && <button className="btn-ghost btn-sm" onClick={() => setEdit({ ...k, startDate: d10(k.startDate), endDate: d10(k.endDate), vendorId: k.vendorId ?? '' })}>編輯</button>}</td>
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
          {edit.id && <div className="sm:col-span-2"><button className="btn-danger btn-sm" onClick={async () => { if (confirm('停用這份合約？') && await act(() => api.delete(`/contracts/${edit.id}`), '已停用')) { setEdit(null); reload(); } }}>停用合約</button></div>}
        </FormModal>
      )}
    </>
  );
}

function VendorList() {
  const canWrite = useCanWrite();
  const { data, error, reload } = useVendors();
  const [edit, setEdit] = useState<any>(null);
  return (
    <>
      {canWrite && <button className="btn-primary mb-3" onClick={() => setEdit({ kind: '其他' })}><Plus className="w-4 h-4" />新增廠商</button>}
      <ErrorBox error={error} />
      {!data ? <Loading /> : !data.length ? <Empty>沒有廠商</Empty> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{data.map((v) => (
          <div key={v.id} className="card">
            <div className="flex items-center gap-2"><span className="badge-mute">{v.kind}</span><b>{v.name}</b>{canWrite && <button className="btn-ghost btn-sm ml-auto" onClick={() => setEdit(v)}>編輯</button>}</div>
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
          {edit.id && <div className="sm:col-span-2"><button className="btn-danger btn-sm" onClick={async () => { if (confirm('停用這家廠商？') && await act(() => api.delete(`/vendors/${edit.id}`), '已停用')) { setEdit(null); reload(); } }}>停用廠商</button></div>}
        </FormModal>
      )}
    </>
  );
}

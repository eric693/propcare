import { useState } from 'react';
import { FileText, Plus, Trash2, Upload } from 'lucide-react';
import api from '../api/client';
import { Page } from '../components/Layout';
import HowTo from '../components/HowTo';
import { act, Empty, ErrorBox, Field, Filter, FormModal, Loading, matches, SearchBox, Tabs, toast, Toolbar, useLoad } from '../components/ui';
import { BarChart } from '../components/charts';
import { useAuth, useCanWrite } from '../context/AuthContext';
import { addDays, d10, today } from '../lib/format';
import { fileSize, openFile } from '../lib/shared';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DOC_CATS = ['規約', '使用執照與圖說', '會議紀錄', '財務報表', '合約', '公告附件', '其他'];
export default function Documents() {
  const [tab, setTab] = useState<'docs' | 'polls'>('docs');
  return (
    <Page title="文件與意見調查">
      <HowTo module="documents" />
      <Tabs value={tab} onChange={setTab} items={[['docs', '社區文件'], ['polls', '住戶意見調查']]} />
      {tab === 'docs' ? <Docs /> : <Polls />}
    </Page>
  );
}

function Docs() {
  const { cid } = useAuth();
  const canWrite = useCanWrite();
  const { data, error, reload } = useLoad(() => api.get<any[]>('/documents').then((r) => r.data), [cid]);
  const [edit, setEdit] = useState<any>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const all = data ?? [];
  const list = all.filter((d) => (!cat || d.category === cat) && matches(q, d.title, d.fileName, d.category));
  return (
    <>
      <Toolbar count={data && `顯示 ${list.length} / ${all.length} 份`}>
        <SearchBox value={q} onChange={setQ} placeholder="搜尋文件名稱" />
        <Filter value={cat} onChange={setCat} all="全部類別" options={[...new Set([...DOC_CATS, ...all.map((d) => d.category)])].map((c) => [c, c])} />
        {canWrite && <button className="btn-primary" onClick={() => setEdit({})}><Upload className="w-4 h-4" />上傳文件</button>}
      </Toolbar>
      <ErrorBox error={error} />
      {!data ? <Loading /> : !list.length ? <Empty>{all.length ? '沒有符合條件的文件' : '還沒有文件。建議先上傳社區規約，住戶可在住戶專區查閱（條例第 35 條）。'}</Empty> : (
        <div className="card p-0 overflow-x-auto"><table className="tbl">
          <thead><tr><th>文件</th><th>類別</th><th>住戶可看</th><th>大小</th><th>上傳</th><th /></tr></thead>
          <tbody>{list.map((d) => (
            <tr key={d.id}>
              <td><button className="font-semibold text-brand hover:underline inline-flex items-center gap-1.5 text-left" onClick={() => openFile(`/documents/${d.id}/file`)}><FileText className="w-4 h-4 shrink-0" />{d.title}</button><div className="text-xs text-gray-400">{d.fileName}</div></td>
              <td><span className="badge-mute">{d.category}</span></td>
              <td>{d.forResidents ? <span className="badge-ok">公開</span> : <span className="badge-mute">僅管理端</span>}</td>
              <td className="num text-gray-500">{fileSize(d.size)}</td>
              <td className="text-xs text-gray-500">{d.createdBy}<div>{d10(d.createdAt)}</div></td>
              <td className="text-right whitespace-nowrap">
                {canWrite && <button className="btn-ghost btn-sm" onClick={() => setEdit(d)}>編輯</button>}
                {canWrite && <button className="btn-ghost btn-sm text-gray-400" onClick={() => confirm(`刪除「${d.title}」？`) && act(() => api.delete(`/documents/${d.id}`), '已刪除').then(reload)}><Trash2 className="w-3.5 h-3.5" /></button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {edit && <DocForm d={edit} onClose={() => setEdit(null)} onSaved={reload} />}
    </>
  );
}

function DocForm({ d, onClose, onSaved }: { d: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ title: d.title ?? '', category: d.category ?? '規約', forResidents: d.forResidents ?? true });
  const [file, setFile] = useState<File | null>(null);
  return (
    <FormModal title={d.id ? '編輯文件' : '上傳文件'} submitText={d.id ? '儲存' : '上傳'} onClose={onClose} onSubmit={async () => {
      if (d.id) { await api.put(`/documents/${d.id}`, f); onSaved(); return; }
      if (!file) throw { response: { data: { error: '請選擇檔案' } } };
      if (file.size > 10 * 1024 * 1024) throw { response: { data: { error: '檔案不可超過 10 MB' } } };
      const data = await new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = bad; r.readAsDataURL(file); });
      await api.post('/documents', { ...f, title: f.title || file.name.replace(/\.[^.]+$/, ''), fileName: file.name, mime: file.type || 'application/octet-stream', data });
      onSaved();
    }}>
      {!d.id && <Field label="檔案（PDF、圖片、Word、Excel，10 MB 以內）" full><input className="input" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>}
      <Field label="文件名稱"><input className="input" placeholder={file?.name ?? ''} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="類別"><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{[...new Set([...DOC_CATS, f.category])].map((c) => <option key={c}>{c}</option>)}</select></Field>
      <Field label="住戶專區" full><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.forResidents} onChange={(e) => setF({ ...f, forResidents: e.target.checked })} />住戶可以查閱下載</label></Field>
    </FormModal>
  );
}

function Polls() {
  const { cid } = useAuth();
  const canWrite = useCanWrite();
  const { data, error, reload } = useLoad(() => api.get<any>('/polls').then((r) => r.data), [cid]);
  const [edit, setEdit] = useState<any>(null);
  return (
    <>
      <div className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-3">意見調查用來了解住戶想法（一戶一票），<b>不是</b>區分所有權人會議的法定表決；須依法決議的事項請到「會議與表決」辦理。</div>
      <Toolbar count={data && `${data.polls.length} 項調查・全社區 ${data.units} 戶`}>
        {canWrite && <button className="btn-primary" onClick={() => setEdit({})}><Plus className="w-4 h-4" />發起調查</button>}
      </Toolbar>
      <ErrorBox error={error} />
      {!data ? <Loading /> : !data.polls.length ? <Empty>還沒有意見調查</Empty> : (
        <div className="grid lg:grid-cols-2 gap-4">{data.polls.map((p: any) => {
          const open = p.endDate >= today();
          return (
            <div key={p.id} className="card">
              <div className="flex items-center gap-2 text-xs mb-1">
                <span className={open ? 'badge-ok' : 'badge-mute'}>{open ? `進行中・${p.endDate} 截止` : `已截止（${p.endDate}）`}</span>
                <span className="text-gray-400">已作答 {p.total} / {data.units} 戶</span>
                <div className="ml-auto flex gap-1">
                  {canWrite && <button className="btn-ghost btn-sm" onClick={() => setEdit(p)}>編輯</button>}
                  {canWrite && <button className="btn-ghost btn-sm text-gray-400" onClick={() => confirm(`刪除「${p.title}」？作答紀錄會一併刪除。`) && act(() => api.delete(`/polls/${p.id}`), '已刪除').then(reload)}><Trash2 className="w-3.5 h-3.5" /></button>}
                </div>
              </div>
              <h3 className="font-semibold">{p.title}</h3>
              {p.description && <p className="text-sm text-gray-600 whitespace-pre-wrap mb-2">{p.description}</p>}
              <BarChart labels={p.options} series={[{ name: '戶數', values: p.counts }]} format={(v) => `${v} 戶`} height={160} integer />
            </div>
          );
        })}</div>
      )}
      {edit && <PollForm p={edit} onClose={() => setEdit(null)} onSaved={reload} />}
    </>
  );
}

function PollForm({ p, onClose, onSaved }: { p: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ title: p.title ?? '', description: p.description ?? '', options: (p.options ?? ['贊成', '反對']).join('\n'), endDate: p.endDate ?? addDays(today(), 14), showResult: p.showResult ?? true });
  return (
    <FormModal title={p.id ? '編輯意見調查' : '發起意見調查'} onClose={onClose} onSubmit={async () => {
      const body = { ...f, options: f.options.split('\n').map((o: string) => o.trim()).filter(Boolean) };
      if (p.id) await api.put(`/polls/${p.id}`, body); else { await api.post('/polls', body); toast('已發起，住戶可在住戶專區作答'); }
      onSaved();
    }}>
      <Field label="調查主題" full><input className="input" autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="說明" full><textarea className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="選項（一行一個，2～10 個）" full hint={p.total ? '已有住戶作答，選項不能修改' : undefined}><textarea className="input" rows={4} disabled={p.total > 0} value={f.options} onChange={(e) => setF({ ...f, options: e.target.value })} /></Field>
      <Field label="截止日"><input className="input" type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
      <Field label="結果"><label className="flex items-center gap-2 text-sm mt-2"><input type="checkbox" checked={f.showResult} onChange={(e) => setF({ ...f, showResult: e.target.checked })} />進行中也讓住戶看結果</label></Field>
    </FormModal>
  );
}

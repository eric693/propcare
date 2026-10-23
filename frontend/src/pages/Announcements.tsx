import { useState } from 'react';
import { Pin, Plus } from 'lucide-react';
import api from '../api/client';
import { Page } from '../components/Layout';
import HowTo from '../components/HowTo';
import { act, Empty, ErrorBox, Field, Filter, FormModal, Loading, matches, SearchBox, toast, Toolbar, useLoad } from '../components/ui';
import { useAuth, useCanWrite } from '../context/AuthContext';
import { d10, today } from '../lib/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
const CATS = ['一般', '停水停電', '會議', '財務', '工程施工', '緊急'];

export default function Announcements() {
  const { cid } = useAuth();
  const canWrite = useCanWrite();
  const { data, error, reload } = useLoad(() => api.get<any>('/announcements').then((r) => r.data), [cid]);
  const [edit, setEdit] = useState<any>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [state, setState] = useState('');
  const stateOf = (a: any) => (a.expireDate && d10(a.expireDate) < today() ? 'expired' : d10(a.publishDate) > today() ? 'scheduled' : 'live');
  const list = (data?.list ?? []).filter((a: any) => (!cat || a.category === cat) && (!state || (state === 'pinned' ? a.pinned : stateOf(a) === state)) && matches(q, a.title, a.body, a.createdBy));
  return (
    <Page title="公告" actions={canWrite && <button className="btn-primary" onClick={() => setEdit({})}><Plus className="w-4 h-4" />發布公告</button>}>
      <HowTo module="announcements" />
      <Toolbar count={data && `顯示 ${list.length} / ${data.list.length} 則`}>
        <SearchBox value={q} onChange={setQ} placeholder="搜尋標題、內容" />
        <Filter value={cat} onChange={setCat} all="全部類別" options={CATS.map((c) => [c, c])} />
        <Filter value={state} onChange={setState} all="全部狀態" options={[['live', '公告中'], ['scheduled', '預約發布'], ['expired', '已下架'], ['pinned', '置頂']]} />
      </Toolbar>
      <ErrorBox error={error} />
      {!data ? <Loading /> : !list.length ? <Empty>{data.list.length ? '沒有符合條件的公告' : '還沒有公告'}</Empty> : (
        <div className="space-y-3">{list.map((a: any) => {
          const expired = a.expireDate && d10(a.expireDate) < today();
          const scheduled = d10(a.publishDate) > today();
          return (
            <div key={a.id} className={`card ${expired ? 'opacity-50' : ''}`}>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {a.pinned && <span className="badge-info"><Pin className="w-3 h-3 mr-0.5" />置頂</span>}
                <span className={a.category === '緊急' ? 'badge-bad' : 'badge-mute'}>{a.category}</span>
                <span className="text-gray-400">{d10(a.publishDate)}{a.expireDate && ` ～ ${d10(a.expireDate)}`}</span>
                {scheduled && <span className="badge-warn">預約發布</span>}{expired && <span className="badge-mute">已下架</span>}
                {a.pushed && <span className="badge-ok">已 LINE 推播</span>}
                <span className="text-gray-400 ml-auto">已讀 {a._count.reads} / {data.residents} 人</span>
              </div>
              <h3 className="font-semibold mt-1.5">{a.title}</h3>
              <p className="text-sm text-gray-600 whitespace-pre-wrap mt-1">{a.body}</p>
              {canWrite && <div className="flex gap-1 mt-2">
                <button className="btn-ghost btn-sm" onClick={() => setEdit(a)}>編輯</button>
                <button className="btn-ghost btn-sm text-red-500" onClick={() => confirm('刪除這則公告？') && act(() => api.delete(`/announcements/${a.id}`), '已刪除').then(reload)}>刪除</button>
              </div>}
            </div>
          );
        })}</div>
      )}
      {edit && <Form a={edit} onClose={() => setEdit(null)} onSaved={reload} />}
    </Page>
  );
}

function Form({ a, onClose, onSaved }: { a: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ title: a.title ?? '', body: a.body ?? '', category: a.category ?? '一般', pinned: a.pinned ?? false, publishDate: d10(a.publishDate) || today(), expireDate: d10(a.expireDate), push: !a.id });
  return (
    <FormModal title={a.id ? '編輯公告' : '發布公告'} wide submitText={a.id ? '儲存' : '發布'} onClose={onClose} onSubmit={async () => {
      const r = await (a.id ? api.put(`/announcements/${a.id}`, f) : api.post('/announcements', f));
      if (r.data.pushed) toast(`已 LINE 推播給 ${r.data.pushed} 位住戶`);
      onSaved();
    }}>
      <Field label="標題" full><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="類別"><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></Field>
      <label className="flex items-center gap-2 text-sm self-end pb-2"><input type="checkbox" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} />置頂</label>
      <Field label="發布日"><input className="input" type="date" value={f.publishDate} onChange={(e) => setF({ ...f, publishDate: e.target.value })} /></Field>
      <Field label="下架日（選填）"><input className="input" type="date" value={f.expireDate} onChange={(e) => setF({ ...f, expireDate: e.target.value })} /></Field>
      <Field label="內容" full><textarea className="input h-48" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.push} onChange={(e) => setF({ ...f, push: e.target.checked })} />同時 LINE 推播給已綁定的住戶（發布日為今天或之前才會推播）</label>
    </FormModal>
  );
}

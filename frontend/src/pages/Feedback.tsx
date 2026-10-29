import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import api from '../api/client';
import { Page } from '../components/Layout';
import HowTo from '../components/HowTo';
import { act, Empty, ErrorBox, Field, Filter, FormModal, Loading, matches, SearchBox, Tabs, Toolbar, useLoad } from '../components/ui';
import { useAuth, useCanWrite } from '../context/AuthContext';
import { dt, L } from '../lib/format';
import { Unit } from '../types';
import { FEEDBACK_CATEGORIES } from '../lib/shared';

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function Feedback() {
  const { cid } = useAuth();
  const canWrite = useCanWrite();
  const { data, error, reload } = useLoad(() => api.get<any[]>('/feedback').then((r) => r.data), [cid]);
  const [tab, setTab] = useState<'OPEN' | 'REPLIED' | 'CLOSED' | 'ALL'>('OPEN');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [reply, setReply] = useState<any>(null);
  const all = data ?? [];
  const count = (s: string) => all.filter((f) => f.status === s).length;
  const list = all.filter((f) => (tab === 'ALL' || f.status === tab) && (!cat || f.category === cat) && matches(q, f.title, f.content, f.unit?.label, f.resident?.name, f.reply));
  return (
    <Page title="住戶意見" actions={canWrite && <button className="btn-primary" onClick={() => setReply({})}><Plus className="w-4 h-4" />登錄意見</button>}>
      <HowTo module="feedback" />
      <Tabs value={tab} onChange={setTab} items={[['OPEN', '待回覆', count('OPEN')], ['REPLIED', '已回覆', count('REPLIED')], ['CLOSED', '已結案'], ['ALL', '全部']]} />
      <Toolbar count={data && `顯示 ${list.length} 則`}>
        <SearchBox value={q} onChange={setQ} placeholder="搜尋主旨、內容、戶別、住戶" />
        <Filter value={cat} onChange={setCat} all="全部類別" options={FEEDBACK_CATEGORIES.map((c) => [c, c])} />
      </Toolbar>
      <ErrorBox error={error} />
      {!data ? <Loading /> : !list.length ? <Empty>{tab === 'OPEN' ? '沒有待回覆的意見' : '沒有符合條件的意見'}</Empty> : (
        <div className="space-y-3">{list.map((f) => (
          <div key={f.id} className="card">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="badge-mute">{f.category}</span>
              <span className={f.status === 'OPEN' ? 'badge-warn' : f.status === 'REPLIED' ? 'badge-info' : 'badge-ok'}>{L.feedbackStatus[f.status]}</span>
              <span className="text-gray-400">{f.unit?.label}・{f.resident?.name ?? '管理中心登錄'}・{dt(f.createdAt)}</span>
              <div className="ml-auto flex gap-1">
                {canWrite && <button className="btn-secondary btn-sm" onClick={() => setReply(f)}>{f.reply ? '編輯' : '回覆'}</button>}
                {canWrite && <button className="btn-ghost btn-sm text-gray-400" onClick={() => confirm('刪除這則意見？') && act(() => api.delete(`/feedback/${f.id}`), '已刪除').then(reload)}><Trash2 className="w-3.5 h-3.5" /></button>}
              </div>
            </div>
            <h3 className="font-semibold mt-2">{f.title}</h3>
            {f.content && <p className="text-sm text-gray-600 whitespace-pre-wrap mt-1">{f.content}</p>}
            {f.reply && <div className="mt-3 text-sm bg-brand-50 rounded-xl px-3 py-2"><div className="text-xs text-brand mb-0.5">管理中心回覆・{f.repliedBy} {f.repliedAt && dt(f.repliedAt)}</div><div className="whitespace-pre-wrap">{f.reply}</div></div>}
          </div>
        ))}</div>
      )}
      {reply && <ReplyForm f={reply} onClose={() => setReply(null)} onSaved={reload} />}
    </Page>
  );
}

function ReplyForm({ f, onClose, onSaved }: { f: any; onClose: () => void; onSaved: () => void }) {
  const { cid } = useAuth();
  const { data: units } = useLoad(() => api.get<Unit[]>('/units').then((r) => r.data), [cid]);
  const [form, setForm] = useState({ unitId: f.unitId ?? '', category: f.category ?? '建議', title: f.title ?? '', content: f.content ?? '', reply: f.reply ?? '', status: !f.id ? 'OPEN' : f.status === 'OPEN' ? 'REPLIED' : f.status });
  const fromStaff = !f.id || !f.residentId;
  return (
    <FormModal title={f.id ? `回覆：${f.title}` : '登錄住戶意見（電話或臨櫃反映）'} submitText={f.id ? '儲存' : '登錄'} onClose={onClose} onSubmit={async () => {
      if (!f.id) { const r = await api.post('/feedback', form); if (form.reply) await api.put(`/feedback/${r.data.id}`, { reply: form.reply, status: form.status === 'OPEN' ? 'REPLIED' : form.status }); }
      else await api.put(`/feedback/${f.id}`, fromStaff ? form : { reply: form.reply, status: form.status });
      onSaved();
    }}>
      {!f.id && <Field label="戶別"><select className="input" value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })}><option value="">請選擇</option>{(units ?? []).map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</select></Field>}
      {fromStaff && <>
        <Field label="類別"><select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{FEEDBACK_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="主旨" full><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label="內容" full><textarea className="input" rows={3} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></Field>
      </>}
      <Field label="回覆內容（住戶會在住戶專區看到，綁定 LINE 者同步通知）" full><textarea className="input" rows={5} autoFocus value={form.reply} onChange={(e) => setForm({ ...form, reply: e.target.value })} /></Field>
      <Field label="狀態"><select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{Object.entries(L.feedbackStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
    </FormModal>
  );
}

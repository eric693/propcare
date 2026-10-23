import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, Plus, Printer, XCircle } from 'lucide-react';
import api from '../api/client';
import { Page } from '../components/Layout';
import HowTo from '../components/HowTo';
import { act, Empty, ErrorBox, Field, Filter, FormModal, Loading, matches, SearchBox, Tabs, Toolbar, useLoad } from '../components/ui';
import { useAuth, useCanWrite } from '../context/AuthContext';
import { L, pct, today } from '../lib/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Meetings() {
  const { cid } = useAuth();
  const canWrite = useCanWrite();
  const nav = useNavigate();
  const { data, error, reload } = useLoad(() => api.get<any[]>('/meetings').then((r) => r.data), [cid]);
  const [edit, setEdit] = useState<any>(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const list = (data ?? []).filter((m) => (!kind || m.kind === kind) && (!status || m.status === status) && matches(q, m.title, m.location, m.agenda, m.minutes));
  return (
    <Page title="會議與表決" actions={canWrite && <button className="btn-primary" onClick={() => setEdit({})}><Plus className="w-4 h-4" />新增會議</button>}>
      <HowTo module="meetings" />
      <Toolbar count={data && `顯示 ${list.length} / ${data.length} 場`}>
        <SearchBox value={q} onChange={setQ} placeholder="搜尋會議名稱、地點、議程、紀錄" />
        <Filter value={kind} onChange={setKind} all="全部會議" options={L.meetingKind} />
        <Filter value={status} onChange={setStatus} all="全部狀態" options={L.meetingStatus} />
      </Toolbar>
      <ErrorBox error={error} />
      {!data ? <Loading /> : !list.length ? <Empty>{data.length ? '沒有符合條件的會議' : '還沒有會議'}</Empty> : (
        <div className="space-y-3">{list.map((m) => (
          <div key={m.id} className="card cursor-pointer hover:border-brand/40" onClick={() => nav(`/meetings/${m.id}`)}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={m.kind === 'OWNERS' ? 'badge-info' : 'badge-mute'}>{L.meetingKind[m.kind]}</span>
              {m.reconvene && <span className="badge-warn">重新召集</span>}
              <span className={m.status === 'HELD' ? 'badge-ok' : m.status === 'CANCELLED' ? 'badge-mute' : 'badge-warn'}>{L.meetingStatus[m.status]}</span>
              {!m.notice.ok && m.status === 'PLANNED' && <span className="badge-bad"><AlertTriangle className="w-3 h-3 mr-0.5" />通知期限</span>}
              {canWrite && <span className="ml-auto flex gap-1" onClick={(e) => e.stopPropagation()}>
                <button className="btn-ghost btn-sm" onClick={() => setEdit(m)}>編輯</button>
                {m.status !== 'HELD' && <button className="btn-ghost btn-sm text-red-500" onClick={() => confirm(`刪除「${m.title}」？簽到與表決紀錄會一併刪除。`) && act(() => api.delete(`/meetings/${m.id}`), '已刪除').then(reload)}>刪除</button>}
              </span>}
            </div>
            <div className="font-semibold mt-1.5">{m.title}</div>
            <div className="text-sm text-gray-500">{m.meetingDate} {m.meetingTime}・{m.location}・簽到 {m._count.attendance} 戶・議案 {m._count.motions} 案</div>
            {!m.notice.ok && m.status === 'PLANNED' && <div className="text-xs text-red-600 mt-1">{m.notice.message}</div>}
          </div>
        ))}</div>
      )}
      {edit && <MeetingForm m={edit} onClose={() => setEdit(null)} onSaved={(id) => id ? nav(`/meetings/${id}`) : reload()} />}
    </Page>
  );
}

function MeetingForm({ m, onClose, onSaved }: { m: any; onClose: () => void; onSaved: (id?: string) => void }) {
  const [f, setF] = useState({
    kind: m.kind ?? 'OWNERS', reconvene: m.reconvene ?? false, urgent: m.urgent ?? false, title: m.title ?? '',
    meetingDate: m.meetingDate ?? '', meetingTime: m.meetingTime ?? '19:30', location: m.location ?? '', noticeDate: m.noticeDate ?? today(),
    agenda: m.agenda ?? '', minutes: m.minutes ?? '', status: m.status ?? 'PLANNED',
  });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <FormModal title={m.id ? '編輯會議' : '新增會議'} wide onClose={onClose} onSubmit={async () => {
      const r = await (m.id ? api.put(`/meetings/${m.id}`, f) : api.post('/meetings', f));
      onSaved(m.id ? undefined : r.data.id);
    }}>
      <Field label="會議類型"><select className="input" value={f.kind} onChange={set('kind')}>{Object.entries(L.meetingKind).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="狀態"><select className="input" value={f.status} onChange={set('status')}>{Object.entries(L.meetingStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="會議名稱" full><input className="input" value={f.title} onChange={set('title')} placeholder="115 年度區分所有權人會議" /></Field>
      <Field label="開會日期"><input className="input" type="date" value={f.meetingDate} onChange={set('meetingDate')} /></Field>
      <Field label="時間"><input className="input" type="time" value={f.meetingTime} onChange={set('meetingTime')} /></Field>
      <Field label="地點"><input className="input" value={f.location} onChange={set('location')} /></Field>
      <Field label="開會通知寄發日" hint={f.kind === 'OWNERS' ? '第 30 條：須於開會前 10 日書面通知；急迫情事得以公告，不少於 2 日' : ''}><input className="input" type="date" value={f.noticeDate} onChange={set('noticeDate')} /></Field>
      {f.kind === 'OWNERS' && <>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.reconvene} onChange={(e) => setF({ ...f, reconvene: e.target.checked })} />重新召集（第 32 條，前次未達定額）</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.urgent} onChange={(e) => setF({ ...f, urgent: e.target.checked })} />急迫情事臨時會（以公告通知）</label>
      </>}
      <Field label="議程" full><textarea className="input h-24" value={f.agenda} onChange={set('agenda')} /></Field>
      <Field label="會議紀錄（會後填寫，住戶可在專區閱覽）" full><textarea className="input h-32" value={f.minutes} onChange={set('minutes')} /></Field>
    </FormModal>
  );
}

export function MeetingDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { cid } = useAuth();
  const canWrite = useCanWrite();
  const { data: d, error, setData, reload } = useLoad(() => api.get<any>(`/meetings/${id}`).then((r) => r.data), [cid, id]);
  const [tab, setTab] = useState<'attend' | 'votes' | 'result'>('attend');
  const [q, setQ] = useState('');
  const [motion, setMotion] = useState<any>(null);
  const [editMeeting, setEditMeeting] = useState(false);
  const [voteMotion, setVoteMotion] = useState<string>('');
  if (error) return <Page title="會議"><ErrorBox error={error} /></Page>;
  if (!d) return <Page title="會議"><Loading /></Page>;
  const m = d.meeting, qr = d.quorum;
  const attendMap = new Map<string, any>(d.attendance.map((a: any) => [a.unitId, a]));
  const units = d.units.filter((u: any) => !q || u.label.includes(q) || u.ownerName.includes(q));
  const curMotion = d.motions.find((x: any) => x.id === voteMotion) ?? d.motions[0];
  const isOwners = m.kind === 'OWNERS';

  const toggle = async (unitId: string, present: boolean, proxy = '') => {
    try { setData((await api.post(`/meetings/${id}/attendance`, { unitId, present, proxy })).data); } catch (e) { act(() => Promise.reject(e)); }
  };
  const vote = async (unitId: string, v: string) => {
    try { setData((await api.put(`/meetings/${id}/motions/${curMotion.id}/votes`, { votes: { [unitId]: v } })).data); } catch (e) { act(() => Promise.reject(e)); }
  };
  const allYes = async () => {
    const votes: Record<string, string> = {};
    for (const a of d.attendance) if (!curMotion.votes[a.unitId]) votes[a.unitId] = 'YES';
    await act(async () => setData((await api.put(`/meetings/${id}/motions/${curMotion.id}/votes`, { votes })).data), '未投票的出席戶已登錄為同意');
  };

  return (
    <Page title={m.title} actions={<>
      <Link to="/meetings" className="btn-ghost"><ArrowLeft className="w-4 h-4" />會議列表</Link>
      {canWrite && <button className="btn-secondary" onClick={() => setEditMeeting(true)}>編輯會議</button>}
      {canWrite && m.status !== 'HELD' && <button className="btn-danger" onClick={async () => { if (confirm(`刪除「${m.title}」？`) && await act(() => api.delete(`/meetings/${m.id}`), '已刪除')) nav('/meetings'); }}>刪除</button>}
    </>}>
      <div className="text-sm text-gray-500 mb-3 -mt-2">{L.meetingKind[m.kind]}{m.reconvene ? '（重新召集）' : ''}・{m.meetingDate} {m.meetingTime}・{m.location}</div>
      {!d.notice.ok && <div className="card border-red-200 bg-red-50 text-sm text-red-700 mb-3 flex gap-2"><AlertTriangle className="w-4 h-4 mt-0.5" />{d.notice.message}</div>}
      {isOwners && (
        <div className={`card mb-4 ${qr.met ? 'border-green-200 bg-green-50/40' : 'border-amber-200 bg-amber-50/40'}`}>
          <div className="flex items-center gap-2 font-semibold">{qr.met ? <CheckCircle2 className="w-5 h-5 text-green-600" /> : <AlertTriangle className="w-5 h-5 text-amber-600" />}
            {qr.met ? '已達法定出席人數，可以開會' : '尚未達法定出席人數'}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-sm">
            <div><div className="text-xs text-gray-500">出席戶數</div><b className="num text-lg">{qr.attendUnits}</b> / {qr.totalUnits} 戶</div>
            <div><div className="text-xs text-gray-500">戶數比例</div><b className="num text-lg">{pct(qr.attendRate)}</b></div>
            <div><div className="text-xs text-gray-500">區分所有權比例</div><b className="num text-lg">{pct(qr.attendShareRate)}</b></div>
            <div><div className="text-xs text-gray-500">法定門檻</div><b className="num text-lg">{pct(qr.required, 1)}</b>{qr.minPeople ? ` 且 ≥ ${qr.minPeople} 人` : ''}</div>
          </div>
          {qr.shareMissing && <div className="text-xs text-amber-700 mt-2">戶別尚未填寫區分所有權比例，暫以戶數計算。請到「戶別與住戶」補齊。</div>}
          {!qr.met && <div className="text-xs text-gray-500 mt-2">還差 {Math.max(0, Math.ceil(qr.totalUnits * qr.required - 1e-9) - qr.attendUnits, qr.minPeople - qr.attendUnits)} 戶（以戶數計）。</div>}
        </div>
      )}
      <Tabs value={tab} onChange={setTab} items={[['attend', '簽到', qr.attendUnits], ['votes', '議案表決', d.motions.length], ['result', '表決結果']]} />

      {tab === 'attend' && (
        <>
          <input className="input max-w-xs mb-3" placeholder="搜尋戶別、所有權人" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">{units.map((u: any) => {
            const a = attendMap.get(u.id);
            return (
              <div key={u.id} className={`rounded-xl border px-3 py-2 text-sm flex items-center gap-2 ${a ? 'bg-brand-50 border-brand/40' : 'bg-white border-gray-100'}`}>
                <input type="checkbox" disabled={!canWrite} checked={!!a} onChange={(e) => toggle(u.id, e.target.checked)} className="w-4 h-4 accent-[#0f6b6f]" />
                <div className="min-w-0 flex-1"><b>{u.label}</b> <span className="text-gray-500">{u.ownerName}</span><div className="text-[11px] text-gray-400">比例 {u.share}{a?.proxy && `・委託 ${a.proxy}`}</div></div>
                {a && canWrite && <button className="text-xs text-brand" onClick={() => { const p = prompt('受託人姓名（空白＝本人出席）', a.proxy); if (p !== null) toggle(u.id, true, p); }}>委託</button>}
              </div>
            );
          })}</div>
        </>
      )}

      {tab === 'votes' && (
        <>
          <div className="flex flex-wrap gap-2 mb-3">
            {d.motions.map((mo: any) => <button key={mo.id} onClick={() => setVoteMotion(mo.id)} className={`btn-sm btn ${curMotion?.id === mo.id ? 'bg-brand text-white' : 'bg-white border border-gray-200'}`}>第 {mo.seq} 案</button>)}
            {canWrite && <button className="btn-secondary btn-sm" onClick={() => setMotion({})}><Plus className="w-3.5 h-3.5" />新增議案</button>}
          </div>
          {!curMotion ? <Empty>還沒有議案</Empty> : (
            <div className="card">
              <div className="flex flex-wrap items-start gap-2 mb-3">
                <div className="flex-1"><div className="font-semibold">第 {curMotion.seq} 案：{curMotion.title}</div><div className="text-sm text-gray-500">{curMotion.description}</div></div>
                <ResultBadge r={curMotion.result} />
                {canWrite && <><button className="btn-ghost btn-sm" onClick={() => setMotion(curMotion)}>編輯</button>
                  <button className="btn-secondary btn-sm" onClick={allYes}>其餘出席戶全數同意</button></>}
              </div>
              <Tally r={curMotion.result} />
              {!d.attendance.length ? <div className="text-sm text-gray-400 py-4">請先在「簽到」登錄出席戶別，才能投票。</div> : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-3">{d.units.filter((u: any) => attendMap.has(u.id)).map((u: any) => {
                  const v = curMotion.votes[u.id] ?? '';
                  return (
                    <div key={u.id} className="flex items-center gap-2 rounded-xl border border-gray-100 px-3 py-1.5 text-sm">
                      <b className="flex-1">{u.label}</b>
                      {(['YES', 'NO', 'ABSTAIN'] as const).map((k) => (
                        <button key={k} disabled={!canWrite} onClick={() => vote(u.id, v === k ? '' : k)}
                          className={`px-2 py-0.5 rounded-lg text-xs ${v === k ? (k === 'YES' ? 'bg-green-600 text-white' : k === 'NO' ? 'bg-red-500 text-white' : 'bg-gray-500 text-white') : 'bg-gray-100 text-gray-500'}`}>{L.vote[k]}</button>
                      ))}
                    </div>
                  );
                })}</div>
              )}
            </div>
          )}
        </>
      )}

      {tab === 'result' && (
        <div className="card">
          <div className="flex justify-end no-print"><button className="btn-secondary" onClick={() => window.print()}><Printer className="w-4 h-4" />列印</button></div>
          <div className="print-area">
            <h2 className="text-lg font-bold text-center mb-1">{m.title} 表決結果</h2>
            <p className="text-center text-sm text-gray-500 mb-4">{m.meetingDate} {m.meetingTime}・{m.location}</p>
            {isOwners && <p className="text-sm mb-3">出席 {qr.attendUnits} / {qr.totalUnits} 戶（{pct(qr.attendRate)}），區分所有權比例 {pct(qr.attendShareRate)}；法定門檻 {pct(qr.required)}，{qr.met ? '已達' : '未達'}法定出席人數。</p>}
            <table className="w-full text-sm border border-gray-200">
              <thead><tr className="bg-gray-50"><th className="p-2 text-left">議案</th><th className="p-2">同意</th><th className="p-2">不同意</th><th className="p-2">棄權</th><th className="p-2">同意比（戶數／比例）</th><th className="p-2">結果</th></tr></thead>
              <tbody>{d.motions.map((mo: any) => (
                <tr key={mo.id} className="border-t"><td className="p-2">第 {mo.seq} 案 {mo.title}</td><td className="p-2 text-center">{mo.result.yes}</td><td className="p-2 text-center">{mo.result.no}</td><td className="p-2 text-center">{mo.result.abstain}</td>
                  <td className="p-2 text-center">{pct(mo.result.yesRate)} ／ {pct(mo.result.yesShareRate)}</td><td className="p-2 text-center font-semibold">{mo.result.passed ? '通過' : '未通過'}</td></tr>
              ))}</tbody>
            </table>
            <p className="text-xs text-gray-500 mt-3">{m.reconvene ? '依公寓大廈管理條例第 32 條：重新召集會議以出席人數過半數及其區分所有權比例占出席人數區分所有權合計過半數之同意作成決議。' : '依公寓大廈管理條例第 31 條：以出席人數四分之三以上及其區分所有權比例占出席人數區分所有權四分之三以上之同意行之。'}規約另有規定者從其規定。</p>
            {m.minutes && <div className="mt-4"><h3 className="font-semibold mb-1">會議紀錄</h3><p className="text-sm whitespace-pre-wrap">{m.minutes}</p></div>}
          </div>
        </div>
      )}
      {motion && (
        <FormModal title={motion.id ? '編輯議案' : '新增議案'} onClose={() => setMotion(null)} onSubmit={async () => {
          const r = await (motion.id ? api.put(`/meetings/${id}/motions/${motion.id}`, { title: motion.title, description: motion.description }) : api.post(`/meetings/${id}/motions`, motion));
          setData(r.data);
        }}>
          <Field label="議案" full><input className="input" value={motion.title ?? ''} onChange={(e) => setMotion({ ...motion, title: e.target.value })} /></Field>
          <Field label="說明" full><textarea className="input h-24" value={motion.description ?? ''} onChange={(e) => setMotion({ ...motion, description: e.target.value })} /></Field>
          {motion.id && <div className="sm:col-span-2"><button className="btn-danger btn-sm" onClick={async () => { if (confirm('刪除這個議案與所有投票？')) { setData((await api.delete(`/meetings/${id}/motions/${motion.id}`)).data); setMotion(null); } }}>刪除議案</button></div>}
        </FormModal>
      )}
      {editMeeting && <MeetingForm m={m} onClose={() => setEditMeeting(false)} onSaved={() => reload()} />}
    </Page>
  );
}

function ResultBadge({ r }: { r: any }) {
  return r.passed ? <span className="badge-ok text-sm px-3 py-1"><CheckCircle2 className="w-4 h-4 mr-1" />通過</span>
    : <span className="badge-bad text-sm px-3 py-1"><XCircle className="w-4 h-4 mr-1" />未通過</span>;
}

function Tally({ r }: { r: any }) {
  const total = r.yes + r.no + r.abstain + r.notVoted || 1;
  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden bg-gray-100 gap-0.5">
        <div className="bg-green-600" style={{ width: `${r.yes / total * 100}%` }} />
        <div className="bg-red-500" style={{ width: `${r.no / total * 100}%` }} />
        <div className="bg-gray-400" style={{ width: `${r.abstain / total * 100}%` }} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 mt-1.5">
        <span><i className="inline-block w-2 h-2 rounded-full bg-green-600 mr-1" />同意 {r.yes}</span>
        <span><i className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1" />不同意 {r.no}</span>
        <span><i className="inline-block w-2 h-2 rounded-full bg-gray-400 mr-1" />棄權 {r.abstain}</span>
        <span>未投 {r.notVoted}</span>
        <span className="ml-auto">同意比：戶數 <b>{pct(r.yesRate)}</b>・比例 <b>{pct(r.yesShareRate)}</b>（門檻{r.strict ? '超過' : ''} {pct(r.required)}）</span>
      </div>
    </div>
  );
}

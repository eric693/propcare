import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, Plus, Printer, QrCode, Trash2 } from 'lucide-react';
import QRCode from 'qrcode';
import api, { errMsg } from '../api/client';
import { Page } from '../components/Layout';
import HowTo from '../components/HowTo';
import { act, Empty, ErrorBox, Field, Filter, FormModal, Loading, matches, Modal, SearchBox, Stat, Tabs, Toolbar, useLoad } from '../components/ui';
import { useAuth, useCanWrite } from '../context/AuthContext';
import { dt, today } from '../lib/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
const scanUrl = (code: string) => `${window.location.origin}/patrol/scan/${code}`;

export default function Patrol() {
  const { cid } = useAuth();
  const canWrite = useCanWrite();
  const [tab, setTab] = useState<'logs' | 'points'>('logs');
  const [date, setDate] = useState(today());
  const { data, error, reload } = useLoad(() => api.get<any>(`/patrol?date=${date}`).then((r) => r.data), [cid, date]);
  const [edit, setEdit] = useState<any>(null);
  const [print, setPrint] = useState(false);
  const [q, setQ] = useState('');
  const [pointF, setPointF] = useState('');
  const [userF, setUserF] = useState('');
  const [activeF, setActiveF] = useState('');
  const [note, setNote] = useState<any>(null);
  const points: any[] = data?.points ?? [];
  const logs: any[] = data?.logs ?? [];
  const active = points.filter((p) => p.active);
  const done = new Set(logs.map((l) => l.pointId));
  const shownLogs = logs.filter((l) => (!pointF || l.pointId === pointF) && (!userF || l.userName === userF) && matches(q, l.point.name, l.userName, l.note));
  const shownPoints = points.filter((p) => (!activeF || (activeF === 'on' ? p.active : !p.active)) && matches(q, p.name, p.location));
  return (
    <Page title="巡邏打卡" actions={canWrite && tab === 'points' && <button className="btn-primary" onClick={() => setEdit({})}><Plus className="w-4 h-4" />新增巡邏點</button>}>
      <HowTo module="patrol" />
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={tab} onChange={setTab} items={[['logs', '巡邏紀錄'], ['points', '巡邏點與 QR Code']]} />
        {tab === 'logs' && <input className="input w-auto ml-auto mb-4" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />}
      </div>
      <ErrorBox error={error} />
      {!data ? <Loading /> : tab === 'logs' ? (
        <>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <Stat label="打卡次數" value={logs.length} />
            <Stat label="已巡巡邏點" value={`${active.filter((p) => done.has(p.id)).length} / ${active.length}`} tone={active.length && active.some((p) => !done.has(p.id)) ? 'warn' : 'ok'} />
            <Stat label="巡邏人員" value={new Set(logs.map((l) => l.userName)).size} />
          </div>
          {active.length > 0 && (
            <div className="card mb-3"><div className="text-xs text-gray-500 mb-2">{date} 各點巡邏狀況</div>
              <div className="flex flex-wrap gap-2">{active.map((p) => <span key={p.id} className={done.has(p.id) ? 'badge-ok' : 'badge-mute'}>{done.has(p.id) && <CheckCircle2 className="w-3 h-3 mr-0.5" />}{p.name}（{logs.filter((l) => l.pointId === p.id).length}）</span>)}</div>
            </div>
          )}
          <Toolbar count={`顯示 ${shownLogs.length} / ${logs.length} 筆`}>
            <SearchBox value={q} onChange={setQ} placeholder="搜尋巡邏點、人員、備註" />
            <Filter value={pointF} onChange={setPointF} all="全部巡邏點" options={points.map((p) => [p.id, p.name])} />
            <Filter value={userF} onChange={setUserF} all="全部人員" options={[...new Set(logs.map((l) => l.userName))].map((u) => [u, u])} />
          </Toolbar>
          {!shownLogs.length ? <Empty>{logs.length ? '沒有符合條件的紀錄' : points.length ? '這天沒有巡邏紀錄' : '請先到「巡邏點與 QR Code」新增巡邏點並列印貼上'}</Empty> : (
            <div className="card p-0 overflow-x-auto"><table className="tbl">
              <thead><tr><th>時間</th><th>巡邏點</th><th>人員</th><th>備註</th><th /></tr></thead>
              <tbody>{shownLogs.map((l) => (
                <tr key={l.id}><td className="whitespace-nowrap">{dt(l.scannedAt)}</td><td>{l.point.name}</td><td>{l.userName}</td><td className="text-xs text-gray-500">{l.note}</td>
                  <td className="text-right whitespace-nowrap">{canWrite && <>
                    <button className="btn-ghost btn-sm" onClick={() => setNote(l)}>編輯</button>
                    <button className="btn-ghost btn-sm text-gray-400" onClick={() => confirm('刪除這筆巡邏紀錄？（例如誤掃）') && act(() => api.delete(`/patrol/logs/${l.id}`), '已刪除').then(reload)}><Trash2 className="w-3.5 h-3.5" /></button>
                  </>}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      ) : (
        <>
          <Toolbar count={`顯示 ${shownPoints.length} / ${points.length} 個`}>
            <SearchBox value={q} onChange={setQ} placeholder="搜尋巡邏點名稱、位置" />
            <Filter value={activeF} onChange={setActiveF} all="全部狀態" options={[['on', '使用中'], ['off', '停用']]} />
            {active.length > 0 && <button className="btn-secondary" onClick={() => setPrint(true)}><Printer className="w-4 h-4" />列印 QR Code</button>}
          </Toolbar>
          {!shownPoints.length ? <Empty>{points.length ? '沒有符合條件的巡邏點' : '還沒有巡邏點'}</Empty> : (
            <div className="card p-0 overflow-x-auto"><table className="tbl">
              <thead><tr><th>順序</th><th>巡邏點</th><th>位置</th><th>狀態</th><th /></tr></thead>
              <tbody>{shownPoints.map((p) => (
                <tr key={p.id} className={p.active ? '' : 'opacity-50'}>
                  <td className="num">{p.seq}</td><td className="font-semibold">{p.name}</td><td className="text-gray-500">{p.location}</td>
                  <td>{p.active ? <span className="badge-ok">使用中</span> : <span className="badge-mute">停用</span>}</td>
                  <td className="text-right whitespace-nowrap">
                    {canWrite && <button className="btn-ghost btn-sm" onClick={() => setEdit(p)}>編輯</button>}
                    {canWrite && p.active && <button className="btn-ghost btn-sm text-gray-400" onClick={() => confirm(`刪除巡邏點「${p.name}」？有打卡紀錄時會改為停用。`) && act(() => api.delete(`/patrol/points/${p.id}`), '已處理').then(reload)}><Trash2 className="w-3.5 h-3.5" /></button>}
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      )}
      {edit && (
        <PointForm p={edit} onClose={() => setEdit(null)} onSaved={reload} />
      )}
      {note && (
        <FormModal title={`編輯巡邏紀錄：${note.point.name} ${dt(note.scannedAt)}`} onClose={() => setNote(null)} onSubmit={async () => { await api.put(`/patrol/logs/${note.id}`, { note: note.note }); reload(); }}>
          <Field label="備註" full><input className="input" autoFocus value={note.note} onChange={(e) => setNote({ ...note, note: e.target.value })} /></Field>
        </FormModal>
      )}
      {print && <PrintCodes points={active} onClose={() => setPrint(false)} />}
    </Page>
  );
}

function PointForm({ p, onClose, onSaved }: { p: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: p.name ?? '', location: p.location ?? '', seq: String(p.seq ?? 1), active: p.active ?? true });
  return (
    <FormModal title={p.id ? '編輯巡邏點' : '新增巡邏點'} onClose={onClose} onSubmit={async () => {
      const body = { ...f, seq: Number(f.seq) };
      if (p.id) await api.put(`/patrol/points/${p.id}`, body); else await api.post('/patrol/points', body);
      onSaved();
    }}>
      <Field label="巡邏點名稱"><input className="input" autoFocus placeholder="地下室 B1 機房" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="位置說明"><input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
      <Field label="巡邏順序"><input className="input" type="number" min={1} value={f.seq} onChange={(e) => setF({ ...f, seq: e.target.value })} /></Field>
      {p.id && <Field label="狀態"><select className="input" value={f.active ? '1' : '0'} onChange={(e) => setF({ ...f, active: e.target.value === '1' })}><option value="1">使用中</option><option value="0">停用</option></select></Field>}
    </FormModal>
  );
}

function PrintCodes({ points, onClose }: { points: any[]; onClose: () => void }) {
  const [imgs, setImgs] = useState<Record<string, string>>({});
  useEffect(() => {
    Promise.all(points.map(async (p) => [p.id, await QRCode.toDataURL(scanUrl(p.code), { margin: 1, width: 360 })] as const)).then((x) => setImgs(Object.fromEntries(x)));
  }, [points]);
  return (
    <Modal title="列印巡邏點 QR Code" wide onClose={onClose} footer={<button className="btn-primary" onClick={() => window.print()}><Printer className="w-4 h-4" />列印</button>}>
      <p className="text-sm text-gray-500 mb-3 no-print">印出後貼在各巡邏點。巡邏人員用手機相機掃描，登入後即完成打卡。</p>
      <div className="print-area grid grid-cols-2 sm:grid-cols-3 gap-4">
        {points.map((p) => (
          <div key={p.id} className="border border-gray-300 rounded-xl p-3 text-center break-inside-avoid">
            {imgs[p.id] ? <img src={imgs[p.id]} alt={p.name} className="mx-auto w-40 h-40" /> : <QrCode className="mx-auto w-40 h-40 text-gray-200" />}
            <div className="font-bold mt-2">{p.name}</div><div className="text-xs text-gray-500">{p.location || '巡邏打卡點'}</div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** 掃描 QR Code 後開啟的打卡頁（需登入員工帳號） */
export function PatrolScan() {
  const { code } = useParams();
  const [state, setState] = useState<{ ok?: any; error?: string }>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { setState({ ok: (await api.post('/patrol/scan', { code, note })).data }); } catch (e) { setState({ error: errMsg(e) }); }
    setBusy(false);
  };
  return (
    <div className="max-w-sm mx-auto p-4 pt-10">
      <div className="card text-center">
        <QrCode className="w-10 h-10 text-brand mx-auto mb-2" />
        <h1 className="font-bold text-lg mb-3">巡邏打卡</h1>
        {state.ok ? (
          <div className="text-green-700"><CheckCircle2 className="w-12 h-12 mx-auto mb-2" /><div className="font-bold">{state.ok.point}</div><div className="text-sm text-gray-500">{state.ok.community}・{dt(state.ok.scannedAt)} 打卡完成</div></div>
        ) : (
          <>
            <input className="input mb-3" placeholder="備註（選填，例如：一切正常）" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn-primary w-full" disabled={busy} onClick={submit}>確認打卡</button>
            {state.error && <div className="text-sm text-red-600 mt-3">{state.error}</div>}
          </>
        )}
        <Link to="/patrol" className="block text-xs text-gray-400 mt-4">回巡邏紀錄</Link>
      </div>
    </div>
  );
}

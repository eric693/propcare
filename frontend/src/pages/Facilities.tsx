import { useState } from 'react';
import { Plus } from 'lucide-react';
import api from '../api/client';
import { Page } from '../components/Layout';
import HowTo from '../components/HowTo';
import { act, Empty, ErrorBox, Field, FormModal, Loading, Tabs, useLoad } from '../components/ui';
import { useAuth, useCanWrite } from '../context/AuthContext';
import { addDays, d10, money, today } from '../lib/format';
import { Unit } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const WEEK = '日一二三四五六';

export default function Facilities() {
  const { cid } = useAuth();
  const canWrite = useCanWrite();
  const [tab, setTab] = useState<'bookings' | 'setup'>('bookings');
  const { data: facilities, error, reload } = useLoad(() => api.get<any[]>('/facilities').then((r) => r.data), [cid]);
  const [edit, setEdit] = useState<any>(null);
  return (
    <Page title="公設預約" actions={canWrite && tab === 'setup' && <button className="btn-primary" onClick={() => setEdit({})}><Plus className="w-4 h-4" />新增設施</button>}>
      <HowTo module="facilities" />
      <Tabs value={tab} onChange={setTab} items={[['bookings', '預約日程'], ['setup', '設施設定', facilities?.length]]} />
      <ErrorBox error={error} />
      {!facilities ? <Loading /> : tab === 'bookings' ? <Bookings facilities={facilities} /> : !facilities.length ? <Empty>尚未建立公共設施</Empty> : (
        <div className="grid md:grid-cols-2 gap-3">{facilities.map((f) => (
          <div key={f.id} className={`card ${f.active ? '' : 'opacity-50'}`}>
            <div className="flex items-start gap-2"><h3 className="font-semibold">{f.name}</h3>{!f.active && <span className="badge-mute">停用</span>}
              {canWrite && <button className="btn-ghost btn-sm ml-auto" onClick={() => setEdit(f)}>編輯</button>}</div>
            <div className="text-sm text-gray-600 mt-1 space-y-0.5">
              <div>開放 {f.openTime}～{f.closeTime}，每時段 {f.slotMinutes} 分鐘，同時段 {f.capacity} 戶</div>
              <div>每戶每週 {f.maxPerWeek || '不限'} 次・最多提前 {f.advanceDays} 天{f.fee ? `・每次 ${money(f.fee)} 元` : ''}</div>
              {f.rules && <div className="text-xs text-gray-400 pt-1">{f.rules}</div>}
            </div>
          </div>
        ))}</div>
      )}
      {edit && <FacilityForm f={edit} onClose={() => setEdit(null)} onSaved={reload} />}
    </Page>
  );
}

function Bookings({ facilities }: { facilities: any[] }) {
  const { cid } = useAuth();
  const canWrite = useCanWrite();
  const [from, setFrom] = useState(today());
  const { data, error, reload } = useLoad(() => api.get<any[]>(`/bookings?from=${from}&to=${addDays(from, 13)}`).then((r) => r.data), [cid, from]);
  const [booking, setBooking] = useState(false);
  const byDay = new Map<string, any[]>();
  for (const b of data ?? []) { const k = d10(b.date); byDay.set(k, [...(byDay.get(k) ?? []), b]); }
  return (
    <>
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <button className="btn-ghost btn-sm" onClick={() => setFrom(addDays(from, -14))}>‹ 前兩週</button>
        <input className="input w-40" type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        <button className="btn-ghost btn-sm" onClick={() => setFrom(addDays(from, 14))}>後兩週 ›</button>
        {canWrite && facilities.some((f) => f.active) && <button className="btn-primary ml-auto" onClick={() => setBooking(true)}><Plus className="w-4 h-4" />代住戶預約</button>}
      </div>
      <ErrorBox error={error} />
      {!data ? <Loading /> : !data.length ? <Empty>這兩週沒有預約</Empty> : (
        <div className="space-y-3">{[...byDay.entries()].map(([day, list]) => (
          <div key={day} className="card">
            <div className="font-semibold text-sm mb-2">{day.slice(5).replace('-', '/')}（{WEEK[new Date(`${day}T00:00:00Z`).getUTCDay()]}）{day === today() && <span className="badge-info ml-1">今天</span>}</div>
            <div className="divide-y divide-gray-50">{list.map((b) => (
              <div key={b.id} className={`flex items-center gap-3 py-2 text-sm ${b.status === 'CANCELLED' ? 'opacity-40 line-through' : ''}`}>
                <span className="font-mono w-28">{b.startTime}～{b.endTime}</span><span className="w-32 font-medium">{b.facility.name}</span>
                <span className="flex-1">{b.unit.label}{b.resident && <span className="text-gray-400"> {b.resident.name}</span>}{b.note && <span className="text-xs text-gray-400 ml-2">{b.note}</span>}</span>
                {canWrite && b.status === 'BOOKED' && <button className="btn-ghost btn-sm text-red-500" onClick={() => confirm('取消這筆預約？') && act(() => api.delete(`/bookings/${b.id}`), '已取消').then(reload)}>取消</button>}
              </div>
            ))}</div>
          </div>
        ))}</div>
      )}
      {booking && <StaffBook facilities={facilities.filter((f) => f.active)} onClose={() => setBooking(false)} onSaved={reload} />}
    </>
  );
}

function StaffBook({ facilities, onClose, onSaved }: { facilities: any[]; onClose: () => void; onSaved: () => void }) {
  const { cid } = useAuth();
  const { data: units } = useLoad(() => api.get<Unit[]>('/units').then((r) => r.data), [cid]);
  const [f, setF] = useState({ facilityId: facilities[0]?.id ?? '', unitId: '', date: today(), startTime: '' });
  const { data: slots } = useLoad(() => f.facilityId ? api.get<any>(`/facilities/${f.facilityId}/slots?date=${f.date}`).then((r) => r.data) : Promise.resolve(null), [f.facilityId, f.date]);
  return (
    <FormModal title="代住戶預約" submitText="預約" onClose={onClose} onSubmit={async () => { await api.post('/bookings', f); onSaved(); }}>
      <Field label="設施"><select className="input" value={f.facilityId} onChange={(e) => setF({ ...f, facilityId: e.target.value, startTime: '' })}>{facilities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      <Field label="戶別"><select className="input" value={f.unitId} onChange={(e) => setF({ ...f, unitId: e.target.value })}><option value="">請選擇</option>{(units ?? []).map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</select></Field>
      <Field label="日期" full><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value, startTime: '' })} /></Field>
      <div className="sm:col-span-2 grid grid-cols-3 sm:grid-cols-4 gap-2">
        {(slots?.slots ?? []).map((s: any) => (
          <button type="button" key={s.start} disabled={!s.left} onClick={() => setF({ ...f, startTime: s.start })}
            className={`rounded-xl border px-2 py-2 text-xs ${f.startTime === s.start ? 'bg-brand text-white border-brand' : s.left ? 'border-gray-200 hover:border-brand' : 'bg-gray-50 text-gray-300 border-gray-100'}`}>
            {s.start}～{s.end}<div>{s.left ? `剩 ${s.left}` : '額滿'}</div>
          </button>
        ))}
      </div>
    </FormModal>
  );
}

function FacilityForm({ f: init, onClose, onSaved }: { f: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ name: '', openTime: '08:00', closeTime: '22:00', slotMinutes: 60, capacity: 1, maxPerWeek: 0, advanceDays: 14, fee: 0, rules: '', active: true, ...init });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <FormModal title={init.id ? `編輯 ${init.name}` : '新增公共設施'} onClose={onClose} onSubmit={async () => {
      const body = { ...f, slotMinutes: Number(f.slotMinutes), capacity: Number(f.capacity), maxPerWeek: Number(f.maxPerWeek), advanceDays: Number(f.advanceDays), fee: Number(f.fee) };
      delete body.id; delete body.communityId;
      await (init.id ? api.put(`/facilities/${init.id}`, body) : api.post('/facilities', body)); onSaved();
    }}>
      <Field label="名稱" full><input className="input" value={f.name} onChange={set('name')} placeholder="健身房" /></Field>
      <Field label="開放時間"><input className="input" type="time" value={f.openTime} onChange={set('openTime')} /></Field>
      <Field label="結束時間"><input className="input" type="time" value={f.closeTime} onChange={set('closeTime')} /></Field>
      <Field label="每時段（分鐘）"><input className="input" type="number" value={f.slotMinutes} onChange={set('slotMinutes')} /></Field>
      <Field label="同時段可預約戶數"><input className="input" type="number" value={f.capacity} onChange={set('capacity')} /></Field>
      <Field label="每戶每週上限（0＝不限）"><input className="input" type="number" value={f.maxPerWeek} onChange={set('maxPerWeek')} /></Field>
      <Field label="最多提前幾天"><input className="input" type="number" value={f.advanceDays} onChange={set('advanceDays')} /></Field>
      <Field label="每次使用費"><input className="input" type="number" value={f.fee} onChange={set('fee')} /></Field>
      <label className="flex items-center gap-2 text-sm self-end pb-2"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />開放預約</label>
      <Field label="使用規則" full><textarea className="input h-20" value={f.rules} onChange={set('rules')} /></Field>
    </FormModal>
  );
}

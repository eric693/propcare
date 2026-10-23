import { useMemo, useState } from 'react';
import { ChevronDown, KeyRound, Pencil, Plus, Trash2, Upload, UserPlus } from 'lucide-react';
import api from '../api/client';
import { Page } from '../components/Layout';
import HowTo from '../components/HowTo';
import { act, Empty, ErrorBox, Field, FormModal, Loading, Tabs, useLoad } from '../components/ui';
import { useAuth, useCanWrite } from '../context/AuthContext';
import { L, money } from '../lib/format';
import { Resident, Unit } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Units() {
  const { cid } = useAuth();
  const canWrite = useCanWrite();
  const [tab, setTab] = useState<'units' | 'parking'>('units');
  const { data: units, error, reload } = useLoad(() => api.get<Unit[]>('/units').then((r) => r.data), [cid]);
  const [q, setQ] = useState('');
  const [building, setBuilding] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [editUnit, setEditUnit] = useState<Partial<Unit> | null>(null);
  const [editRes, setEditRes] = useState<(Partial<Resident> & { unitId: string }) | null>(null);
  const [importing, setImporting] = useState(false);

  const buildings = useMemo(() => [...new Set((units ?? []).map((u) => u.building).filter(Boolean))].sort(), [units]);
  const shown = (units ?? []).filter((u) => (!building || u.building === building)
    && (!q || [u.label, u.ownerName, ...u.residents.flatMap((r) => [r.name, r.phone])].some((s) => s?.includes(q))));
  const totalShare = (units ?? []).reduce((s, u) => s + u.share, 0);

  return (
    <Page title="戶別與住戶" actions={canWrite && tab === 'units' && <>
      <button className="btn-secondary" onClick={() => setImporting(true)}><Upload className="w-4 h-4" />批次匯入</button>
      <button className="btn-primary" onClick={() => setEditUnit({ occupancy: 'SELF' })}><Plus className="w-4 h-4" />新增戶別</button>
    </>}>
      <HowTo module="units" />
      <Tabs value={tab} onChange={setTab} items={[['units', '戶別與住戶', units?.length], ['parking', '車位']]} />
      <ErrorBox error={error} />
      {tab === 'parking' ? <Parking units={units ?? []} /> : !units ? <Loading /> : (
        <>
          <div className="flex flex-wrap gap-2 mb-3">
            <input className="input max-w-xs" placeholder="搜尋戶別、姓名、電話" value={q} onChange={(e) => setQ(e.target.value)} />
            {buildings.length > 1 && <select className="input w-auto" value={building} onChange={(e) => setBuilding(e.target.value)}><option value="">全部棟別</option>{buildings.map((b) => <option key={b} value={b}>{b} 棟</option>)}</select>}
            <div className="text-xs text-gray-400 self-center ml-auto">共 {units.length} 戶・住戶 {units.reduce((s, u) => s + u.residents.length, 0)} 人・比例合計 {Math.round(totalShare * 100) / 100}</div>
          </div>
          {!units.length ? <Empty>還沒有戶別。請按「批次匯入」從 Excel 貼上，或逐戶新增。</Empty> : (
            <div className="card p-0 divide-y divide-gray-50">
              {shown.map((u) => (
                <div key={u.id}>
                  <button className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50" onClick={() => setOpen(open === u.id ? null : u.id)}>
                    <div className="w-28 font-semibold text-sm">{u.label}</div>
                    <div className="flex-1 min-w-0 text-sm text-gray-600 truncate">{u.residents.map((r) => r.name).join('、') || <span className="text-gray-300">無住戶資料</span>}</div>
                    <div className="hidden sm:block text-xs text-gray-400 w-24 num">{u.area} 坪</div>
                    <div className="hidden sm:block text-xs text-gray-500 w-24 num text-right">月繳 {money(u.monthlyFee)}</div>
                    <div className="w-24 text-right">{u.owed.count > 0 ? <span className={u.owed.count > 2 ? 'badge-bad' : 'badge-warn'}>欠 {u.owed.count} 期</span> : <span className="badge-mute">{L.occupancy[u.occupancy]}</span>}</div>
                    <ChevronDown className={`w-4 h-4 text-gray-300 transition-transform ${open === u.id ? 'rotate-180' : ''}`} />
                  </button>
                  {open === u.id && (
                    <div className="px-4 pb-4 bg-gray-50/50">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-gray-500 mb-3">
                        <div>所有權人：<b className="text-gray-700">{u.ownerName || '-'}</b></div>
                        <div>坪數：<b className="text-gray-700">{u.area}</b>・比例 <b className="text-gray-700">{u.share}</b></div>
                        <div>車位：<b className="text-gray-700">{u.parkingSpaces.map((p) => p.code).join('、') || '-'}</b></div>
                        <div>未繳：<b className={u.owed.amount ? 'text-red-600' : 'text-gray-700'}>{money(u.owed.amount)} 元</b></div>
                      </div>
                      <div className="space-y-1.5">
                        {u.residents.map((r) => (
                          <div key={r.id} className="flex flex-wrap items-center gap-2 bg-white rounded-xl px-3 py-2 border border-gray-100 text-sm">
                            <b>{r.name}</b><span className="badge-mute">{L.relation[r.relation]}</span>
                            <span className="text-gray-500 num">{r.phone || '無手機'}</span>
                            {r.lineBound && <span className="badge-ok">LINE</span>}
                            <span className="text-xs text-gray-400">{r.lastLogin ? '已使用住戶專區' : r.phone ? '尚未登入' : ''}</span>
                            {canWrite && <span className="ml-auto flex gap-1">
                              <button className="btn-ghost btn-sm" onClick={() => setEditRes({ ...r, unitId: u.id })}><Pencil className="w-3.5 h-3.5" />編輯</button>
                              {r.phone && <button className="btn-ghost btn-sm" onClick={() => act(() => api.post(`/residents/${r.id}/reset-password`), '密碼已重設為手機末 6 碼')}><KeyRound className="w-3.5 h-3.5" />重設密碼</button>}
                              <button className="btn-ghost btn-sm text-red-500" onClick={() => confirm(`移除住戶 ${r.name}？`) && act(() => api.delete(`/residents/${r.id}`), '已移除').then(reload)}><Trash2 className="w-3.5 h-3.5" /></button>
                            </span>}
                          </div>
                        ))}
                      </div>
                      {canWrite && <div className="flex gap-2 mt-3">
                        <button className="btn-secondary btn-sm" onClick={() => setEditRes({ unitId: u.id, relation: u.occupancy === 'RENT' ? 'TENANT' : 'OWNER' })}><UserPlus className="w-3.5 h-3.5" />新增住戶</button>
                        <button className="btn-ghost btn-sm" onClick={() => setEditUnit(u)}><Pencil className="w-3.5 h-3.5" />編輯戶別</button>
                        <button className="btn-ghost btn-sm text-red-500 ml-auto" onClick={() => confirm(`停用戶別 ${u.label}？歷史帳務會保留。`) && act(() => api.delete(`/units/${u.id}`), '已停用').then(reload)}>停用戶別</button>
                      </div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {editUnit && <UnitForm unit={editUnit} onClose={() => setEditUnit(null)} onSaved={reload} />}
      {editRes && <ResidentForm r={editRes} units={units ?? []} onClose={() => setEditRes(null)} onSaved={reload} />}
      {importing && <ImportForm onClose={() => setImporting(false)} onSaved={reload} />}
    </Page>
  );
}

function UnitForm({ unit, onClose, onSaved }: { unit: Partial<Unit>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ label: '', building: '', floor: '', no: '', area: 0, share: 0, ownerName: '', note: '', ...unit, feeOverride: unit.feeOverride ?? '' });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <FormModal title={unit.id ? `編輯 ${unit.label}` : '新增戶別'} onClose={onClose} onSubmit={async () => {
      const body = { ...f, feeOverride: f.feeOverride === '' ? null : Number(f.feeOverride) };
      await (unit.id ? api.put(`/units/${unit.id}`, body) : api.post('/units', body)); onSaved();
    }}>
      <Field label="戶別（顯示名稱）" full><input className="input" placeholder="A棟 5F-1" value={f.label} onChange={set('label')} /></Field>
      <Field label="棟別"><input className="input" value={f.building} onChange={set('building')} /></Field>
      <Field label="樓層"><input className="input" value={f.floor} onChange={set('floor')} /></Field>
      <Field label="計費坪數"><input className="input" type="number" step="0.01" value={f.area} onChange={set('area')} /></Field>
      <Field label="區分所有權比例" hint="依權狀或規約；區權會表決使用"><input className="input" type="number" step="0.0001" value={f.share} onChange={set('share')} /></Field>
      <Field label="所有權人"><input className="input" value={f.ownerName} onChange={set('ownerName')} /></Field>
      <Field label="使用狀態"><select className="input" value={f.occupancy} onChange={set('occupancy')}>{Object.entries(L.occupancy).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="固定月管理費（選填）" hint="填了就不依坪數計算，例如店面另訂費率" full><input className="input" type="number" value={f.feeOverride} onChange={set('feeOverride')} /></Field>
      <Field label="備註" full><input className="input" value={f.note} onChange={set('note')} /></Field>
    </FormModal>
  );
}

function ResidentForm({ r, units, onClose, onSaved }: { r: Partial<Resident> & { unitId: string }; units: Unit[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ name: '', phone: '', email: '', relation: 'OWNER', note: '', ...r });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <FormModal title={r.id ? `編輯住戶 ${r.name}` : '新增住戶'} onClose={onClose} onSubmit={async () => {
      const body = { unitId: f.unitId, name: f.name, phone: f.phone, email: f.email, relation: f.relation, note: f.note };
      await (r.id ? api.put(`/residents/${r.id}`, body) : api.post('/residents', body)); onSaved();
    }}>
      <Field label="戶別"><select className="input" value={f.unitId} onChange={set('unitId')}>{units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</select></Field>
      <Field label="身分"><select className="input" value={f.relation} onChange={set('relation')}>{Object.entries(L.relation).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="姓名"><input className="input" value={f.name} onChange={set('name')} /></Field>
      <Field label="手機" hint={r.id ? '' : '填了就能登入住戶專區，初始密碼為手機末 6 碼'}><input className="input" inputMode="tel" placeholder="0912345678" value={f.phone} onChange={set('phone')} /></Field>
      <Field label="Email" full><input className="input" value={f.email} onChange={set('email')} /></Field>
      <Field label="備註" full><input className="input" value={f.note} onChange={set('note')} /></Field>
    </FormModal>
  );
}

function ImportForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState('');
  return (
    <FormModal title="批次匯入戶別" wide submitText="匯入" onClose={onClose} onSubmit={async () => {
      const r = await api.post('/units/import', { text });
      onSaved();
      alert(`新增 ${r.data.created} 戶、更新 ${r.data.updated} 戶${r.data.errors.length ? `\n\n無法匯入：\n${r.data.errors.join('\n')}` : ''}`);
    }}>
      <Field label="從 Excel 複製貼上（每行一戶）" full hint="欄位順序：戶別、棟、樓、號、坪數、區分所有權比例、所有權人。以 Tab 或逗號分隔；同名戶別會更新資料。">
        <textarea className="input font-mono text-xs h-56" value={text} onChange={(e) => setText(e.target.value)} placeholder={'A棟 2F-1\tA\t2F\t1\t34.2\t34.2\t王小明\nA棟 2F-2\tA\t2F\t2\t28.6\t28.6\t李小華'} />
      </Field>
    </FormModal>
  );
}

function Parking({ units }: { units: Unit[] }) {
  const { cid } = useAuth();
  const canWrite = useCanWrite();
  const { data, error, reload } = useLoad(() => api.get<any[]>('/parking').then((r) => r.data), [cid]);
  const [edit, setEdit] = useState<any>(null);
  return (
    <>
      <ErrorBox error={error} />
      {canWrite && <button className="btn-primary mb-3" onClick={() => setEdit({ code: '', kind: 'CAR', unitId: '', monthlyFee: 500 })}><Plus className="w-4 h-4" />新增車位</button>}
      {!data ? <Loading /> : !data.length ? <Empty>尚未登記車位</Empty> : (
        <div className="card p-0 overflow-x-auto"><table className="tbl">
          <thead><tr><th>車位</th><th>類型</th><th>使用戶別</th><th>月清潔費</th><th>備註</th><th /></tr></thead>
          <tbody>{data.map((p) => (
            <tr key={p.id}><td className="font-semibold">{p.code}</td><td>{p.kind === 'CAR' ? '汽車' : '機車'}</td><td>{p.unit?.label ?? <span className="text-gray-300">空位</span>}</td><td className="num">{money(p.monthlyFee)}</td><td className="text-gray-500">{p.note}</td>
              <td className="text-right">{canWrite && <button className="btn-ghost btn-sm" onClick={() => setEdit({ ...p, unitId: p.unitId ?? '' })}>編輯</button>}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      {edit && (
        <FormModal title={edit.id ? `編輯車位 ${edit.code}` : '新增車位'} onClose={() => setEdit(null)} onSubmit={async () => {
          const body = { code: edit.code, kind: edit.kind, unitId: edit.unitId || null, monthlyFee: edit.monthlyFee, note: edit.note ?? '' };
          await (edit.id ? api.put(`/parking/${edit.id}`, body) : api.post('/parking', body)); reload();
        }}>
          <Field label="車位編號"><input className="input" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></Field>
          <Field label="類型"><select className="input" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}><option value="CAR">汽車</option><option value="MOTO">機車</option></select></Field>
          <Field label="使用戶別"><select className="input" value={edit.unitId} onChange={(e) => setEdit({ ...edit, unitId: e.target.value })}><option value="">（空位）</option>{units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</select></Field>
          <Field label="月清潔維護費"><input className="input" type="number" value={edit.monthlyFee} onChange={(e) => setEdit({ ...edit, monthlyFee: e.target.value })} /></Field>
          <Field label="備註" full><input className="input" value={edit.note ?? ''} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></Field>
        </FormModal>
      )}
    </>
  );
}

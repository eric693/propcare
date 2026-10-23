import { createContext, FormEvent, ReactNode, useContext, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Bell, CalendarDays, ChevronRight, Home, LogOut, Megaphone, Package, Receipt, User, Wrench } from 'lucide-react';
import api, { errMsg, rapi, RESIDENT_TOKEN } from '../../api/client';
import { Empty, ErrorBox, Field, Filter, FormModal, Loading, matches, SearchBox, Tabs, toast, useLoad } from '../../components/ui';
import { addDays, d10, dt, L, money, thisMonth, addMonth, today, pct } from '../../lib/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
interface RMe { id: string; name: string; phone: string; relation: string; unit: { id: string; label: string }; community: { id: string; name: string; phone: string; bankInfo: string }; mustChangePassword: boolean; lineBound: boolean; lineEnabled: boolean }
const Ctx = createContext<{ me: RMe | null; reload: () => void }>({ me: null, reload: () => {} });
const useMe = () => useContext(Ctx);

export function ResidentLogin() {
  const nav = useNavigate();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [choose, setChoose] = useState<any[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<any>(null);
  useEffect(() => { api.get('/auth/demo').then((r) => setDemo(r.data)).catch(() => {}); }, []);
  if (localStorage.getItem(RESIDENT_TOKEN)) return <Navigate to="/r" replace />;

  async function submit(e?: FormEvent, residentId?: string) {
    e?.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await rapi.post('/resident/login', { phone: phone.trim(), password, residentId });
      if (r.data.choose) setChoose(r.data.choose);
      else { localStorage.setItem(RESIDENT_TOKEN, r.data.token); nav('/r'); }
    } catch (e) { setErr(errMsg(e)); }
    setBusy(false);
  }
  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-4 bg-gradient-to-br from-brand-50 to-warm">
      <form onSubmit={submit} className="card w-full max-w-sm p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 bg-brand rounded-xl flex items-center justify-center"><Home className="w-6 h-6 text-white" strokeWidth={2.5} /></div>
          <div><div className="text-lg font-bold">住戶專區</div><div className="text-xs text-gray-400">管理費・包裹・公設預約・報修</div></div>
        </div>
        {choose ? (
          <>
            <div className="text-sm text-gray-600 mb-2">您在多個社區有住戶身分，請選擇：</div>
            <div className="space-y-2">{choose.map((c) => <button type="button" key={c.id} className="w-full text-left card py-3 hover:border-brand" onClick={() => submit(undefined, c.id)}><b>{c.community}</b><div className="text-sm text-gray-500">{c.unit} {c.name}</div></button>)}</div>
          </>
        ) : <>
          <label className="label">手機號碼</label>
          <input className="input mb-3" inputMode="tel" autoComplete="username" placeholder="0912345678" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus />
          <label className="label">密碼</label>
          <input className="input mb-1" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="text-xs text-gray-400 mb-4">第一次登入密碼為手機末 6 碼。忘記密碼請洽管理中心重設。</p>
          {err && <div className="text-sm text-red-600 mb-3">{err}</div>}
          <button className="btn-primary w-full py-2.5" disabled={busy}>{busy ? '登入中…' : '登入'}</button>
          {demo?.residentPhone && <div className="mt-4 text-xs bg-brand-50 border border-brand-light rounded-xl p-3 text-gray-600">
            <b>示範住戶</b>：{demo.residentPhone} / {demo.residentPassword}
            <button type="button" className="ml-2 text-brand font-semibold" onClick={() => { setPhone(demo.residentPhone); setPassword(demo.residentPassword); }}>帶入</button>
          </div>}
        </>}
        <div className="mt-4 text-sm text-right"><Link to="/login" className="text-gray-400">管理人員登入</Link></div>
      </form>
    </div>
  );
}

const TABS = [
  { to: '/r', label: '首頁', icon: Home, end: true },
  { to: '/r/bills', label: '管理費', icon: Receipt },
  { to: '/r/booking', label: '預約', icon: CalendarDays },
  { to: '/r/repairs', label: '報修', icon: Wrench },
  { to: '/r/news', label: '公告', icon: Megaphone },
];

export function ResidentLayout() {
  const nav = useNavigate();
  const { data: me, error, reload } = useLoad(() => rapi.get<RMe>('/resident/me').then((r) => r.data), []);
  if (!localStorage.getItem(RESIDENT_TOKEN)) return <Navigate to="/r/login" replace />;
  if (error) return <div className="p-6"><ErrorBox error={error} /></div>;
  if (!me) return <Loading />;
  if (me.mustChangePassword) return <ForceChange onDone={reload} />;
  return (
    <Ctx.Provider value={{ me, reload }}>
      <div className="min-h-[100dvh] bg-warm pb-20">
        <header className="bg-brand text-white pt-safe">
          <div className="max-w-xl mx-auto px-4 py-3 flex items-center gap-2">
            <div className="min-w-0"><div className="font-bold truncate">{me.community.name}</div><div className="text-xs text-white/80">{me.unit.label}・{me.name}</div></div>
            <button onClick={() => nav('/r/me')} className="ml-auto p-2 rounded-lg hover:bg-white/10" aria-label="我的帳號"><User className="w-5 h-5" /></button>
          </div>
        </header>
        <main className="max-w-xl mx-auto px-4 py-4"><Outlet /></main>
        <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-100 pb-safe z-50">
          <div className="max-w-xl mx-auto flex">{TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `flex-1 flex flex-col items-center gap-0.5 py-2 text-[11px] ${isActive ? 'text-brand font-semibold' : 'text-gray-400'}`}>
              <t.icon className="w-5 h-5" />{t.label}
            </NavLink>
          ))}</div>
        </nav>
      </div>
    </Ctx.Provider>
  );
}

function ForceChange({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [err, setErr] = useState('');
  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6">
        <h2 className="font-bold text-lg mb-1">請設定新密碼</h2>
        <p className="text-sm text-gray-500 mb-4">為了保護您的資料，第一次登入請把預設密碼（手機末 6 碼）改成自己的密碼。</p>
        <input className="input mb-2" type="password" placeholder="目前密碼（手機末 6 碼）" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} />
        <input className="input mb-2" type="password" placeholder="新密碼（至少 8 碼）" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} />
        <input className="input mb-3" type="password" placeholder="再輸入一次新密碼" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
        {err && <div className="text-sm text-red-600 mb-2">{err}</div>}
        <button className="btn-primary w-full" onClick={async () => {
          if (f.newPassword !== f.confirm) { setErr('兩次輸入的新密碼不同'); return; }
          try { await rapi.put('/resident/password', f); toast('密碼已設定'); onDone(); } catch (e) { setErr(errMsg(e)); }
        }}>確認</button>
      </div>
    </div>
  );
}

function Section({ title, to, children }: { title: string; to?: string; children: ReactNode }) {
  return (
    <div className="card mb-3">
      <div className="flex items-center mb-2"><h3 className="font-semibold text-sm">{title}</h3>{to && <Link to={to} className="ml-auto text-xs text-brand flex items-center">全部<ChevronRight className="w-3.5 h-3.5" /></Link>}</div>
      {children}
    </div>
  );
}

export function RHome() {
  const { me } = useMe();
  const { data: d, error } = useLoad(() => rapi.get<any>('/resident/home').then((r) => r.data), []);
  if (error) return <ErrorBox error={error} />;
  if (!d || !me) return <Loading />;
  return (
    <>
      <div className={`card mb-3 ${d.owed ? 'border-red-200' : 'border-green-200'}`}>
        <div className="text-xs text-gray-500">應繳管理費</div>
        <div className={`text-3xl font-bold num ${d.owed ? 'text-red-600' : 'text-green-700'}`}>{d.owed ? `${money(d.owed)} 元` : '已全部繳清'}</div>
        {d.bills.length > 0 && <div className="text-xs text-gray-500 mt-1">{d.bills.map((b: any) => `${b.period}（${d10(b.dueDate)} 到期）`).join('、')}</div>}
        {d.owed > 0 && me.community.bankInfo && <div className="text-xs bg-gray-50 rounded-lg p-2 mt-2">繳費帳戶：{me.community.bankInfo}</div>}
      </div>
      <Section title={`待領包裹（${d.packages.length}）`}>
        {d.packages.length ? d.packages.map((p: any) => (
          <div key={p.id} className="flex items-center gap-3 py-2 border-t border-gray-50 first:border-0">
            <Package className="w-5 h-5 text-brand" />
            <div className="flex-1 text-sm">{L.pkgKind[p.kind]}・{p.carrier}<div className="text-xs text-gray-400">{dt(p.receivedAt)} 代收</div></div>
            <div className="text-right"><div className="text-[11px] text-gray-400">取件碼</div><div className="font-mono text-xl font-bold tracking-widest text-brand">{p.pickupCode}</div></div>
          </div>
        )) : <div className="text-sm text-gray-400">沒有待領包裹</div>}
      </Section>
      <Section title="最新公告" to="/r/news">
        {d.announcements.length ? d.announcements.map((a: any) => (
          <Link key={a.id} to="/r/news" className="block py-2 border-t border-gray-50 first:border-0">
            <div className="text-sm flex items-center gap-1.5">{!a.read && <span className="w-2 h-2 rounded-full bg-red-500" />}{a.pinned && <span className="badge-info">置頂</span>}<span className="truncate">{a.title}</span></div>
            <div className="text-xs text-gray-400">{d10(a.publishDate)}・{a.category}</div>
          </Link>
        )) : <div className="text-sm text-gray-400">沒有公告</div>}
      </Section>
      <Section title="我的預約" to="/r/booking">
        {d.bookings.length ? d.bookings.map((b: any) => <div key={b.id} className="text-sm py-1.5">{d10(b.date).slice(5)} {b.startTime}～{b.endTime}　{b.facility.name}</div>) : <div className="text-sm text-gray-400">沒有預約</div>}
      </Section>
      {d.repairs.length > 0 && <Section title="處理中的報修" to="/r/repairs">
        {d.repairs.map((r: any) => <div key={r.id} className="text-sm py-1.5 flex"><span className="flex-1 truncate">{r.title}</span><span className={L.repairCls[r.status]}>{L.repair[r.status]}</span></div>)}
      </Section>}
      {!me.lineBound && me.lineEnabled && <Link to="/r/me" className="card flex items-center gap-3 bg-green-50 border-green-200"><Bell className="w-5 h-5 text-green-600" /><div className="text-sm flex-1">綁定 LINE，包裹到了、繳費提醒馬上通知您</div><ChevronRight className="w-4 h-4 text-gray-400" /></Link>}
    </>
  );
}

export function RBills() {
  const { me } = useMe();
  const { data, error } = useLoad(() => rapi.get<any[]>('/resident/bills').then((r) => r.data), []);
  const [st, setSt] = useState<'all' | 'owe' | 'paid'>('all');
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const list = data.filter((b) => st === 'all' || (st === 'paid' ? b.status === 'PAID' : b.status !== 'PAID'));
  return (
    <>
      <h2 className="font-bold mb-3">管理費帳單</h2>
      <Tabs value={st} onChange={setSt} items={[['all', '全部', data.length], ['owe', '未繳清', data.filter((b) => b.status !== 'PAID').length], ['paid', '已繳清']]} />
      {me?.community.bankInfo && <div className="card text-xs text-gray-600 mb-3">繳費帳戶：{me.community.bankInfo}<br />繳費後若有疑問，請洽管理中心 {me.community.phone}</div>}
      {!list.length ? <Empty>{data.length ? '沒有符合的帳單' : '還沒有帳單'}</Empty> : list.map((b) => (
        <div key={b.id} className="card mb-2">
          <div className="flex items-center"><b>{b.period}</b><span className={`${L.billCls[b.status]} ml-2`}>{L.bill[b.status]}</span><span className="ml-auto font-bold num">{money(b.total)} 元</span></div>
          <div className="text-xs text-gray-500 mt-1">管理費 {money(b.amountMgmt)}{b.amountParking ? `・車位 ${money(b.amountParking)}` : ''}{b.amountOther ? `・${b.otherNote || '其他'} ${money(b.amountOther)}` : ''}・期限 {d10(b.dueDate)}</div>
          {b.payments.map((p: any) => <div key={p.receiptNo} className="text-xs text-green-700 mt-1">{d10(p.paidDate)} {L.method[p.method]} {money(p.amount)} 元・收據 {p.receiptNo}</div>)}
          {b.status === 'PARTIAL' && <div className="text-xs text-red-600 mt-1">尚欠 {money(b.total - b.paid)} 元</div>}
        </div>
      ))}
    </>
  );
}

export function RBooking() {
  const { data: facilities, error } = useLoad(() => rapi.get<any[]>('/resident/facilities').then((r) => r.data), []);
  const { data: mine, reload } = useLoad(() => rapi.get<any[]>('/resident/bookings').then((r) => r.data), []);
  const [fid, setFid] = useState('');
  const [date, setDate] = useState(today());
  const cur = fid || facilities?.[0]?.id || '';
  const { data: slots, reload: reloadSlots } = useLoad(() => cur ? rapi.get<any>(`/resident/facilities/${cur}/slots?date=${date}`).then((r) => r.data) : Promise.resolve(null), [cur, date]);
  if (error) return <ErrorBox error={error} />;
  if (!facilities) return <Loading />;
  if (!facilities.length) return <Empty>社區目前沒有開放預約的公共設施</Empty>;
  const f = slots?.facility;
  const days = Array.from({ length: Math.min(8, (f?.advanceDays ?? 7) + 1) }, (_, i) => addDays(today(), i));
  async function book(start: string) {
    if (!confirm(`預約 ${f.name} ${date} ${start}？${f.fee ? `\n使用費 ${f.fee} 元` : ''}`)) return;
    try { await rapi.post('/resident/bookings', { facilityId: cur, date, startTime: start }); toast('預約成功'); reload(); reloadSlots(); } catch (e) { toast(errMsg(e), true); }
  }
  return (
    <>
      <h2 className="font-bold mb-3">公設預約</h2>
      <div className="flex gap-2 overflow-x-auto mb-3">{facilities.map((x) => <button key={x.id} onClick={() => setFid(x.id)} className={`btn btn-sm ${cur === x.id ? 'bg-brand text-white' : 'bg-white border border-gray-200'}`}>{x.name}</button>)}</div>
      {f?.rules && <div className="text-xs text-gray-500 card mb-3">{f.rules}{f.maxPerWeek ? `（每戶每週最多 ${f.maxPerWeek} 次）` : ''}</div>}
      <div className="flex gap-1.5 overflow-x-auto mb-3">{days.map((d) => (
        <button key={d} onClick={() => setDate(d)} className={`rounded-xl px-3 py-1.5 text-xs whitespace-nowrap ${date === d ? 'bg-brand text-white' : 'bg-white border border-gray-200'}`}>
          {d === today() ? '今天' : `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`}<div>週{'日一二三四五六'[new Date(`${d}T00:00:00Z`).getUTCDay()]}</div></button>
      ))}<input type="date" className="input w-36 text-xs" min={today()} max={slots?.maxDate} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
      {!slots ? <Loading /> : (
        <div className="grid grid-cols-2 gap-2 mb-5">{slots.slots.map((s: any) => (
          <button key={s.start} disabled={!s.left || s.mine} onClick={() => book(s.start)}
            className={`rounded-xl border p-3 text-left ${s.mine ? 'bg-brand-50 border-brand' : s.left ? 'bg-white border-gray-200 hover:border-brand' : 'bg-gray-50 border-gray-100 text-gray-300'}`}>
            <div className="font-semibold text-sm">{s.start}～{s.end}</div>
            <div className="text-xs">{s.mine ? '已預約' : s.left ? `剩 ${s.left} 位` : '額滿'}</div>
          </button>
        ))}</div>
      )}
      <h3 className="font-semibold text-sm mb-2">我的預約</h3>
      {!(mine ?? []).length ? <div className="text-sm text-gray-400">沒有預約</div> : (mine ?? []).map((b) => (
        <div key={b.id} className={`card mb-2 flex items-center text-sm ${b.status === 'CANCELLED' || d10(b.date) < today() ? 'opacity-50' : ''}`}>
          <div className="flex-1">{b.facility.name}<div className="text-xs text-gray-500">{d10(b.date)} {b.startTime}～{b.endTime}{b.status === 'CANCELLED' && '・已取消'}</div></div>
          {b.status === 'BOOKED' && d10(b.date) >= today() && <button className="btn-ghost btn-sm text-red-500" onClick={async () => { if (confirm('取消這筆預約？')) { try { await rapi.delete(`/resident/bookings/${b.id}`); toast('已取消'); reload(); reloadSlots(); } catch (e) { toast(errMsg(e), true); } } }}>取消</button>}
        </div>
      ))}
    </>
  );
}

const CATS = ['水電', '電梯', '門禁對講', '消防', '照明', '漏水', '公設損壞', '清潔環境', '停車場', '其他'];
export function RRepairs() {
  const { me } = useMe();
  const { data, error, reload } = useLoad(() => rapi.get<any[]>('/resident/repairs').then((r) => r.data), []);
  const [adding, setAdding] = useState<any>(null);
  const empty = { area: 'PUBLIC', category: '水電', location: '', title: '', description: '' };
  const [f, setF] = useState(empty);
  const [q, setQ] = useState('');
  const [st, setSt] = useState('');
  const list = (data ?? []).filter((r) => (!st || (st === 'open' ? ['NEW', 'ASSIGNED', 'WORKING'].includes(r.status) : !['NEW', 'ASSIGNED', 'WORKING'].includes(r.status))) && matches(q, r.title, r.description, r.location, r.repairNo));
  const open = (r: any) => { setF(r.id ? { area: r.area, category: r.category, location: r.location, title: r.title, description: r.description } : empty); setAdding(r); };
  return (
    <>
      <div className="flex items-center mb-3"><h2 className="font-bold">報修</h2><button className="btn-primary btn-sm ml-auto" onClick={() => open({})}>我要報修</button></div>
      {(data?.length ?? 0) > 3 && <div className="flex gap-2 mb-3"><SearchBox value={q} onChange={setQ} placeholder="搜尋報修" /><Filter value={st} onChange={setSt} all="全部" options={[['open', '處理中'], ['done', '已完成']]} /></div>}
      <ErrorBox error={error} />
      {!data ? <Loading /> : !list.length ? <Empty>{data.length ? '沒有符合的報修' : '沒有報修紀錄'}</Empty> : list.map((r) => (
        <div key={r.id} className="card mb-2">
          <div className="flex items-center gap-2"><b className="flex-1 text-sm">{r.title}</b><span className={L.repairCls[r.status]}>{L.repair[r.status]}</span></div>
          <div className="text-xs text-gray-400">{r.repairNo}・{dt(r.createdAt)}・{L.area[r.area]} {r.location}</div>
          <ol className="mt-2 border-l-2 border-gray-100 pl-3 space-y-1">{r.logs.map((l: any) => <li key={l.id} className="text-xs text-gray-600"><span className="text-gray-400">{dt(l.createdAt)}</span>　{l.text}</li>)}</ol>
          {r.status === 'NEW' && r.residentId === me?.id && <div className="flex gap-1 mt-2">
            <button className="btn-ghost btn-sm" onClick={() => open(r)}>修改</button>
            <button className="btn-ghost btn-sm text-red-500" onClick={async () => { if (confirm('撤回這筆報修？')) { try { await rapi.delete(`/resident/repairs/${r.id}`); toast('已撤回'); reload(); } catch (e) { toast(errMsg(e), true); } } }}>撤回</button>
          </div>}
        </div>
      ))}
      {adding && (
        <FormModal title={adding.id ? '修改報修' : '我要報修'} submitText={adding.id ? '儲存' : '送出'} onClose={() => setAdding(null)} onSubmit={async () => {
          if (adding.id) { await rapi.put(`/resident/repairs/${adding.id}`, f); toast('已修改'); }
          else { await rapi.post('/resident/repairs', f); toast('已送出，管理中心處理後會更新進度'); }
          setF(empty); reload();
        }}>
          <Field label="區域"><select className="input" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })}><option value="PUBLIC">公共區域</option><option value="PRIVATE">我家室內</option></select></Field>
          <Field label="類別"><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="位置" full><input className="input" placeholder="例如：B 棟 3F 梯廳" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
          <Field label="問題" full><input className="input" placeholder="例如：走道燈不亮" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="說明" full><textarea className="input h-24" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        </FormModal>
      )}
    </>
  );
}

export function RNews() {
  const [tab, setTab] = useState<'ann' | 'report' | 'meetings'>('ann');
  return (
    <>
      <Tabs value={tab} onChange={setTab} items={[['ann', '公告'], ['report', '社區財報'], ['meetings', '會議']]} />
      {tab === 'ann' ? <RAnnouncements /> : tab === 'report' ? <RReport /> : <RMeetings />}
    </>
  );
}

function RAnnouncements() {
  const { data, error, reload } = useLoad(() => rapi.get<any[]>('/resident/announcements').then((r) => r.data), []);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  if (!data.length) return <Empty>沒有公告</Empty>;
  const cats = [...new Set(data.map((a) => a.category))];
  const list = data.filter((a) => (!cat || a.category === cat) && matches(q, a.title, a.body));
  return <>
    <div className="flex gap-2 mb-3"><SearchBox value={q} onChange={setQ} placeholder="搜尋公告" /><Filter value={cat} onChange={setCat} all="全部類別" options={cats.map((c) => [c, c])} /></div>
    {!list.length && <Empty>沒有符合的公告</Empty>}
    {list.map((a) => (
    <button key={a.id} className="card mb-2 w-full text-left" onClick={async () => { setOpen(open === a.id ? null : a.id); if (!a.read) { await rapi.post(`/resident/announcements/${a.id}/read`).catch(() => {}); reload(); } }}>
      <div className="flex items-center gap-1.5 text-xs">{!a.read && <span className="w-2 h-2 rounded-full bg-red-500" />}{a.pinned && <span className="badge-info">置頂</span>}<span className={a.category === '緊急' ? 'badge-bad' : 'badge-mute'}>{a.category}</span><span className="text-gray-400 ml-auto">{d10(a.publishDate)}</span></div>
      <div className="font-semibold mt-1">{a.title}</div>
      {open === a.id ? <p className="text-sm text-gray-600 whitespace-pre-wrap mt-1">{a.body}</p> : <p className="text-sm text-gray-400 truncate mt-0.5">{a.body}</p>}
    </button>
  ))}</>;
}

function RReport() {
  const [month, setMonth] = useState(addMonth(thisMonth(), -1));
  const { data: r, error } = useLoad(() => rapi.get<any>(`/resident/report?month=${month}`).then((x) => x.data), [month]);
  const sum = (fund: string, dir: string) => (r?.items ?? []).filter((i: any) => i.fund === fund && i.direction === dir).reduce((s: number, i: any) => s + i.amount, 0);
  return (
    <>
      <div className="flex items-center gap-1 mb-3"><button className="btn-ghost btn-sm" onClick={() => setMonth(addMonth(month, -1))}>‹</button><b className="flex-1 text-center">{month.replace('-', ' 年 ')} 月</b><button className="btn-ghost btn-sm" disabled={month >= thisMonth()} onClick={() => setMonth(addMonth(month, 1))}>›</button></div>
      <ErrorBox error={error} />
      {!r ? <Loading /> : <>
        <div className="card mb-3"><div className="text-xs text-gray-500">管理費收繳率</div><div className="text-2xl font-bold">{r.collection.rate == null ? '-' : `${r.collection.rate}%`}</div><div className="text-xs text-gray-500">{r.collection.paidBills} / {r.collection.bills} 戶繳清</div></div>
        {(['MGMT', 'RESERVE'] as const).map((fund) => (
          <div key={fund} className="card mb-3">
            <h3 className="font-semibold text-sm mb-2">{L.fund[fund]}</h3>
            <div className="text-sm space-y-1">
              <div className="flex"><span className="flex-1 text-gray-500">上月結存</span><span className="num">{money(r.opening[fund === 'MGMT' ? 'mgmt' : 'reserve'])}</span></div>
              {r.items.filter((i: any) => i.fund === fund).map((i: any) => <div key={i.direction + i.category} className="flex"><span className="flex-1 pl-3 text-gray-600">{i.direction === 'IN' ? '＋' : '－'} {i.category}</span><span className={`num ${i.direction === 'IN' ? 'text-green-700' : ''}`}>{money(i.amount)}</span></div>)}
              <div className="flex border-t pt-1"><span className="flex-1 text-gray-500">收入 {money(sum(fund, 'IN'))}・支出 {money(sum(fund, 'OUT'))}</span></div>
              <div className="flex font-bold"><span className="flex-1">本月結存</span><span className="num">{money(r.closing[fund === 'MGMT' ? 'mgmt' : 'reserve'])}</span></div>
            </div>
          </div>
        ))}
      </>}
    </>
  );
}

function RMeetings() {
  const { data, error } = useLoad(() => rapi.get<any[]>('/resident/meetings').then((r) => r.data), []);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  if (!data.length) return <Empty>沒有會議資料</Empty>;
  return <>{data.map((m) => (
    <div key={m.id} className="card mb-2">
      <div className="flex items-center gap-2 text-xs"><span className="badge-mute">{L.meetingKind[m.kind]}</span><span className={m.status === 'HELD' ? 'badge-ok' : 'badge-warn'}>{m.status === 'HELD' ? '已召開' : '即將召開'}</span></div>
      <div className="font-semibold mt-1">{m.title}</div>
      <div className="text-xs text-gray-500">{m.meetingDate} {m.meetingTime}・{m.location}</div>
      {m.agenda && <p className="text-xs text-gray-600 whitespace-pre-wrap mt-2">{m.agenda}</p>}
      {m.result && m.kind === 'OWNERS' && <div className="text-xs mt-2 bg-gray-50 rounded-lg p-2">出席 {m.result.quorum.attendUnits} / {m.result.quorum.totalUnits} 戶（{pct(m.result.quorum.attendRate)}）
        {m.result.motions.map((mo: any) => <div key={mo.id}>第 {mo.seq} 案 {mo.title}：<b className={mo.result.passed ? 'text-green-700' : 'text-red-600'}>{mo.result.passed ? '通過' : '未通過'}</b>（同意 {pct(mo.result.yesRate)}）</div>)}</div>}
      {m.minutes && <details className="mt-2 text-xs"><summary className="text-brand cursor-pointer">會議紀錄</summary><p className="whitespace-pre-wrap text-gray-600 mt-1">{m.minutes}</p></details>}
    </div>
  ))}</>;
}

export function RMe() {
  const { me, reload } = useMe();
  const nav = useNavigate();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [code, setCode] = useState<any>(null);
  if (!me) return null;
  return (
    <>
      <div className="card mb-3"><b>{me.name}</b><div className="text-sm text-gray-500">{me.community.name} {me.unit.label}・{L.relation[me.relation]}・{me.phone}</div>
        {me.community.phone && <a href={`tel:${me.community.phone}`} className="btn-secondary btn-sm mt-2">撥打管理中心 {me.community.phone}</a>}</div>
      <div className="card mb-3">
        <h3 className="font-semibold text-sm mb-2">LINE 通知</h3>
        {me.lineBound ? <div className="flex items-center"><span className="badge-ok">已綁定</span><button className="btn-ghost btn-sm ml-auto" onClick={async () => { await rapi.delete('/resident/line'); reload(); }}>解除綁定</button></div>
          : code ? (code.lineEnabled
            ? <div className="text-sm">請在 10 分鐘內，把綁定碼 <b className="text-2xl font-mono tracking-widest text-brand">{code.code}</b> 傳給社區的 LINE 官方帳號。</div>
            : <div className="text-sm text-amber-700">社區尚未開通 LINE 通知，請洽管理中心。</div>)
          : <button className="btn-secondary" onClick={async () => setCode((await rapi.post('/resident/line/code')).data)}>綁定 LINE（包裹、繳費提醒）</button>}
      </div>
      <div className="card mb-3">
        <h3 className="font-semibold text-sm mb-2">修改密碼</h3>
        <input className="input mb-2" type="password" placeholder="目前密碼" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
        <input className="input mb-2" type="password" placeholder="新密碼（至少 8 碼）" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
        <button className="btn-primary" onClick={async () => { try { await rapi.put('/resident/password', pw); setPw({ currentPassword: '', newPassword: '' }); toast('密碼已更新'); } catch (e) { toast(errMsg(e), true); } }}>更新密碼</button>
      </div>
      <button className="btn-ghost w-full" onClick={() => { localStorage.removeItem(RESIDENT_TOKEN); nav('/r/login'); }}><LogOut className="w-4 h-4" />登出</button>
    </>
  );
}

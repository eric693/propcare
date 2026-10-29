import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ReactNode, Suspense, useEffect, useState } from 'react';
import {
  Building2, CalendarDays, ClipboardCheck, FileText, Gavel, Home, LayoutDashboard, LogOut, Megaphone, Menu,
  Package, Receipt, Settings, ShieldCheck, Users, Wallet, Wrench, X, MoreHorizontal, Building,
  UserCheck, Footprints, MessageSquare, FolderOpen, Boxes,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Loading } from './ui';
import { L } from '../lib/format';

type Item = { to: string; label: string; icon: typeof Home; admin?: boolean; end?: boolean };
const GROUPS: { label: string; items: Item[] }[] = [
  { label: '每日作業', items: [
    { to: '/', label: '工作台', icon: LayoutDashboard, end: true },
    { to: '/packages', label: '包裹代收', icon: Package },
    { to: '/repairs', label: '報修', icon: Wrench },
    { to: '/facilities', label: '公設預約', icon: CalendarDays },
    { to: '/announcements', label: '公告', icon: Megaphone },
    { to: '/visitors', label: '訪客登記', icon: UserCheck },
    { to: '/patrol', label: '巡邏打卡', icon: Footprints },
    { to: '/feedback', label: '住戶意見', icon: MessageSquare },
  ] },
  { label: '財務', items: [
    { to: '/fees', label: '管理費', icon: Receipt },
    { to: '/ledger', label: '收支帳與月報', icon: Wallet },
  ] },
  { label: '社區管理', items: [
    { to: '/units', label: '戶別與住戶', icon: Users },
    { to: '/meetings', label: '會議與表決', icon: Gavel },
    { to: '/vendors', label: '廠商與法定檢查', icon: ClipboardCheck },
    { to: '/documents', label: '文件與意見調查', icon: FolderOpen },
    { to: '/assets', label: '財產清冊', icon: Boxes },
  ] },
  { label: '物業公司', items: [
    { to: '/overview', label: '公司總覽', icon: Building },
    { to: '/community', label: '社區設定', icon: Settings },
    { to: '/accounts', label: '帳號權限', icon: ShieldCheck, admin: true },
    { to: '/settings', label: '我的帳號', icon: FileText },
  ] },
];
const TABS: Item[] = [
  { to: '/', label: '工作台', icon: LayoutDashboard, end: true },
  { to: '/packages', label: '包裹', icon: Package },
  { to: '/repairs', label: '報修', icon: Wrench },
  { to: '/fees', label: '管理費', icon: Receipt },
];

export default function Layout() {
  const { user, cid, setCid, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [loc.pathname]);
  const community = user?.communities.find((c) => c.id === cid);

  const link = (it: Item, small = false) => (
    <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) =>
      small
        ? `flex-1 flex flex-col items-center gap-0.5 py-1.5 text-[11px] ${isActive ? 'text-brand font-semibold' : 'text-gray-400'}`
        : `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${isActive ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
      <it.icon className={small ? 'w-5 h-5' : 'w-4 h-4'} />{it.label}
    </NavLink>
  );

  return (
    <div className="flex h-[100dvh] bg-warm overflow-hidden">
      {open && <div className="md:hidden fixed inset-0 bg-black/40 z-[55]" onClick={() => setOpen(false)} />}
      <aside className={`${open ? 'fixed inset-y-0 left-0 z-[56] flex shadow-2xl pt-safe' : 'hidden'} md:static md:flex md:shadow-none flex-col w-64 max-w-[82vw] md:w-60 bg-white border-r border-gray-100 flex-shrink-0 no-print`}>
        <div className="px-4 py-4 border-b border-gray-100 flex items-center gap-2.5">
          <div className="w-8 h-8 bg-brand rounded-lg flex items-center justify-center"><Home className="w-4 h-4 text-white" strokeWidth={2.5} /></div>
          <div><div className="font-bold text-sm leading-tight">PropCare</div><div className="text-xs text-gray-400">物業管家</div></div>
          <button onClick={() => setOpen(false)} className="md:hidden ml-auto p-1.5 rounded-lg hover:bg-gray-100" aria-label="關閉選單"><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="mx-3 mt-3 mb-1 bg-brand-50 border border-brand-light rounded-xl p-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1.5"><Building2 className="w-3.5 h-3.5" />目前社區</div>
          {user && user.communities.length > 1 ? (
            <select className="input py-1.5 font-semibold" value={cid} onChange={(e) => { setCid(e.target.value); nav('/'); }}>
              {user.communities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ) : <div className="font-semibold text-sm">{community?.name ?? '尚未指派社區'}</div>}
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-1">
          {GROUPS.map((g) => {
            const items = g.items.filter((i) => !i.admin || user?.role === 'ADMIN');
            return items.length ? (
              <div key={g.label} className="mb-1">
                <div className="px-3 pt-3 pb-1 text-[11px] font-semibold text-gray-400 tracking-wider">{g.label}</div>
                <div className="space-y-0.5">{items.map((i) => link(i))}</div>
              </div>
            ) : null;
          })}
        </nav>
        <div className="px-4 py-3 border-t border-gray-100 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-brand text-white flex items-center justify-center text-sm font-bold">{user?.name.charAt(0)}</div>
          <div className="min-w-0 flex-1"><div className="text-sm font-semibold truncate">{user?.name}</div><div className="text-xs text-gray-400 truncate">{user && (user.title || L.role[user.role])}</div></div>
          <button onClick={() => { logout(); nav('/login'); }} className="p-2 rounded-lg hover:bg-gray-100" title="登出" aria-label="登出"><LogOut className="w-4 h-4 text-gray-400" /></button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden flex items-center gap-2 px-3 py-2.5 bg-white border-b border-gray-100 pt-safe no-print">
          <button onClick={() => setOpen(true)} className="p-1.5 rounded-lg hover:bg-gray-100" aria-label="開啟選單"><Menu className="w-5 h-5 text-gray-600" /></button>
          <div className="font-semibold text-sm truncate">{community?.name ?? 'PropCare'}</div>
        </header>
        <main className="flex-1 overflow-y-auto pb-20 md:pb-0">
          {user && !user.communities.length && loc.pathname !== '/accounts' && loc.pathname !== '/settings' ? (
            <div className="max-w-xl mx-auto p-6"><div className="card text-sm text-gray-500">您的帳號尚未被指派任何社區，請聯絡物業公司管理員。{user.role === 'ADMIN' && <button className="btn-primary mt-3" onClick={() => nav('/overview')}>新增第一個社區</button>}</div></div>
          ) : <Suspense fallback={<Loading />}><Outlet /></Suspense>}
        </main>
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-white border-t border-gray-100 flex pb-safe no-print">
          {TABS.map((t) => link(t, true))}
          <button onClick={() => setOpen(true)} className="flex-1 flex flex-col items-center gap-0.5 py-1.5 text-[11px] text-gray-400"><MoreHorizontal className="w-5 h-5" />更多</button>
        </nav>
      </div>
    </div>
  );
}

export function Page({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="max-w-6xl mx-auto px-4 py-5">
      <div className="page-header no-print">
        <h1 className="text-xl font-bold text-gray-800">{title}</h1>
        {actions && <div className="flex gap-2 flex-wrap">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

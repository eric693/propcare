import type React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CalendarDays, ClipboardCheck, Wrench } from 'lucide-react';
import api from '../api/client';
import { Page } from '../components/Layout';
import HowTo from '../components/HowTo';
import { ErrorBox, Loading, Stat, useLoad } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { d10, daysFrom, L, money } from '../lib/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Dashboard() {
  const { cid } = useAuth();
  const nav = useNavigate();
  const { data: d, error } = useLoad(() => api.get<any>('/dashboard').then((r) => r.data), [cid]);
  if (error) return <Page title="工作台"><ErrorBox error={error} /></Page>;
  if (!d) return <Page title="工作台"><Loading /></Page>;
  const c = d.collection;
  return (
    <Page title={`${d.community.name}`}>
      <HowTo module="dashboard" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label={`${d.period} 管理費收繳`} value={c.rate == null ? '未開帳' : `${c.rate}%`} sub={`${money(c.paid)} / ${money(c.billed)} 元`} onClick={() => nav('/fees')} />
        <Stat label="欠費" value={`${d.arrears.units} 戶`} tone={d.arrears.overTwo ? 'bad' : undefined} sub={`逾二期 ${d.arrears.overTwo} 戶・${money(d.arrears.amount)} 元`} onClick={() => nav('/fees?tab=arrears')} />
        <Stat label="待領包裹" value={d.packages.waiting} tone={d.packages.overdue ? 'warn' : undefined} sub={d.packages.overdue ? `逾期未領 ${d.packages.overdue} 件` : '無逾期'} onClick={() => nav('/packages')} />
        <Stat label="處理中報修" value={d.repairs.length} tone={d.repairs.some((r: any) => r.priority === 'URGENT') ? 'bad' : undefined} sub={`待核准支出 ${d.pendingApprovals} 筆`} onClick={() => nav('/repairs')} />
      </div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Stat label="管理費帳戶餘額" value={money(d.balance.mgmt)} sub="已核准收支" onClick={() => nav('/ledger')} />
        <Stat label="公共基金餘額" value={money(d.balance.reserve)} sub="專戶" onClick={() => nav('/ledger')} />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Panel icon={Wrench} title="處理中報修" more={() => nav('/repairs')}>
          {d.repairs.length ? d.repairs.map((r: any) => (
            <Row key={r.id} main={<><span className={L.priorityCls[r.priority]}>{L.priority[r.priority]}</span> {r.title}</>} sub={`${r.unit?.label ?? '公共區域'}・${r.location}`} right={<span className={L.repairCls[r.status]}>{L.repair[r.status]}</span>} />
          )) : <None>沒有處理中的報修</None>}
        </Panel>
        <Panel icon={CalendarDays} title="今日公設預約" more={() => nav('/facilities')}>
          {d.todayBookings.length ? d.todayBookings.map((b: any) => (
            <Row key={b.id} main={`${b.startTime}～${b.endTime} ${b.facility.name}`} sub={b.unit.label} />
          )) : <None>今天沒有預約</None>}
        </Panel>
        <Panel icon={ClipboardCheck} title="60 天內到期：法定檢查與合約" more={() => nav('/vendors')}>
          {d.inspections.map((i: any) => {
            const left = daysFrom(i.dueDate);
            return <Row key={i.id} main={i.title} sub={`期限 ${d10(i.dueDate)}`} right={<span className={left < 0 ? 'badge-bad' : left <= 14 ? 'badge-warn' : 'badge-mute'}>{left < 0 ? `逾期 ${-left} 天` : `${left} 天後`}</span>} />;
          })}
          {d.contracts.map((k: any) => <Row key={k.id} main={`合約：${k.title}`} sub={`${k.vendor?.name ?? ''} ${d10(k.endDate)} 到期`} right={<span className="badge-warn">續約</span>} />)}
          {!d.inspections.length && !d.contracts.length && <None>近期沒有到期事項</None>}
        </Panel>
        {d.pendingApprovals > 0 && (
          <Panel icon={AlertTriangle} title="待核准支出" more={() => nav('/ledger')}>
            <div className="text-sm text-gray-600 py-2">有 {d.pendingApprovals} 筆支出等待管委會委員核准，核准後才會計入帳戶餘額。</div>
          </Panel>
        )}
      </div>
    </Page>
  );
}

function Panel({ icon: Icon, title, children, more }: { icon: typeof Wrench; title: string; children: React.ReactNode; more?: () => void }) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-2"><Icon className="w-4 h-4 text-brand" /><h3 className="font-semibold text-sm">{title}</h3>
        {more && <button onClick={more} className="ml-auto text-xs text-brand">查看全部 →</button>}</div>
      <div className="divide-y divide-gray-50">{children}</div>
    </div>
  );
}
function Row({ main, sub, right }: { main: React.ReactNode; sub?: string; right?: React.ReactNode }) {
  return <div className="flex items-center gap-3 py-2"><div className="min-w-0 flex-1"><div className="text-sm truncate">{main}</div>{sub && <div className="text-xs text-gray-400 truncate">{sub}</div>}</div>{right}</div>;
}
function None({ children }: { children: React.ReactNode }) { return <div className="text-sm text-gray-400 py-3">{children}</div>; }

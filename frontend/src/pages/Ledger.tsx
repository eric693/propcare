import { useState } from 'react';
import { Check, Plus, Printer, Trash2, X } from 'lucide-react';
import api from '../api/client';
import { Page } from '../components/Layout';
import HowTo from '../components/HowTo';
import { act, Empty, ErrorBox, Field, FormModal, Loading, Stat, Tabs, useLoad } from '../components/ui';
import { useAuth, useCanWrite } from '../context/AuthContext';
import { addMonth, d10, L, money, thisMonth, today } from '../lib/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Ledger() {
  const [tab, setTab] = useState<'entries' | 'report'>('entries');
  const [month, setMonth] = useState(thisMonth());
  return (
    <Page title="收支帳與月報">
      <HowTo module="ledger" />
      <div className="flex flex-wrap items-center gap-2 mb-3 no-print">
        <Tabs value={tab} onChange={setTab} items={[['entries', '收支明細'], ['report', '月報（公告用）']]} />
        <div className="flex items-center gap-1 ml-auto mb-4">
          <button className="btn-ghost btn-sm" onClick={() => setMonth(addMonth(month, -1))}>‹</button>
          <input className="input w-36" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          <button className="btn-ghost btn-sm" onClick={() => setMonth(addMonth(month, 1))}>›</button>
        </div>
      </div>
      {tab === 'entries' ? <Entries month={month} /> : <Report month={month} />}
    </Page>
  );
}

function Entries({ month }: { month: string }) {
  const { cid, user } = useAuth();
  const canWrite = useCanWrite();
  const [fund, setFund] = useState('');
  const { data, error, reload } = useLoad(() => api.get<any>(`/ledger?month=${month}&fund=${fund}`).then((r) => r.data), [cid, month, fund]);
  const [adding, setAdding] = useState(false);
  const canApprove = user?.role !== 'MANAGER';
  const rows: any[] = data?.rows ?? [];
  const sum = (dir: string) => rows.filter((r) => r.direction === dir && r.approval === 'APPROVED').reduce((s, r) => s + r.amount, 0);
  return (
    <>
      <ErrorBox error={error} />
      {!data ? <Loading /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
            <Stat label="管理費帳戶餘額" value={money(data.balance.mgmt)} />
            <Stat label="公共基金餘額" value={money(data.balance.reserve)} />
            <Stat label={`${month} 收入`} value={money(sum('IN'))} tone="ok" />
            <Stat label={`${month} 支出`} value={money(sum('OUT'))} sub={`待核准 ${rows.filter((r) => r.approval === 'PENDING').length} 筆`} />
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            <select className="input w-auto" value={fund} onChange={(e) => setFund(e.target.value)}><option value="">兩個帳戶</option><option value="MGMT">管理費帳戶</option><option value="RESERVE">公共基金</option></select>
            {canWrite && <button className="btn-primary ml-auto" onClick={() => setAdding(true)}><Plus className="w-4 h-4" />記一筆</button>}
          </div>
          {!rows.length ? <Empty>{month} 沒有收支紀錄</Empty> : (
            <div className="card p-0 overflow-x-auto"><table className="tbl">
              <thead><tr><th>日期</th><th>帳戶</th><th>科目</th><th>說明</th><th className="text-right">收入</th><th className="text-right">支出</th><th>狀態</th><th>經手</th><th /></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id} className={r.approval === 'REJECTED' ? 'opacity-50' : ''}>
                  <td className="whitespace-nowrap">{d10(r.date)}</td>
                  <td><span className={r.fund === 'RESERVE' ? 'badge-info' : 'badge-mute'}>{r.fund === 'RESERVE' ? '公共基金' : '管理費'}</span></td>
                  <td>{r.category}</td><td className="text-gray-600 text-xs max-w-xs">{r.description}{r.vendor && <span className="text-gray-400">（{r.vendor.name}）</span>}</td>
                  <td className="num text-right text-green-700">{r.direction === 'IN' ? money(r.amount) : ''}</td>
                  <td className="num text-right">{r.direction === 'OUT' ? money(r.amount) : ''}</td>
                  <td><span className={r.approval === 'PENDING' ? 'badge-warn' : r.approval === 'REJECTED' ? 'badge-bad' : 'badge-ok'}>{L.approval[r.approval]}</span>{r.approvedBy && <div className="text-[11px] text-gray-400">{r.approvedBy}</div>}</td>
                  <td className="text-xs text-gray-500">{r.createdBy}</td>
                  <td className="text-right whitespace-nowrap">
                    {r.approval === 'PENDING' && canApprove && <>
                      <button className="btn-primary btn-sm" onClick={() => act(() => api.post(`/ledger/${r.id}/approve`, { approve: true }), '已核准').then(reload)}><Check className="w-3.5 h-3.5" />核准</button>
                      <button className="btn-ghost btn-sm" onClick={() => act(() => api.post(`/ledger/${r.id}/approve`, { approve: false }), '已退回').then(reload)}><X className="w-3.5 h-3.5" />退回</button>
                    </>}
                    {canWrite && !r.paymentId && <button className="btn-ghost btn-sm text-gray-400" onClick={() => confirm('刪除這筆收支？') && act(() => api.delete(`/ledger/${r.id}`), '已刪除').then(reload)}><Trash2 className="w-3.5 h-3.5" /></button>}
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      )}
      {adding && data && <EntryForm categories={data.categories} onClose={() => setAdding(false)} onSaved={reload} />}
    </>
  );
}

function EntryForm({ categories, onClose, onSaved }: { categories: { in: string[]; out: string[] }; onClose: () => void; onSaved: () => void }) {
  const { cid } = useAuth();
  const { data: vendors } = useLoad(() => api.get<any[]>('/vendors').then((r) => r.data), [cid]);
  const [f, setF] = useState({ date: today(), fund: 'MGMT', direction: 'OUT', category: categories.out[0], amount: '', description: '', vendorId: '', voucherNo: '' });
  const cats = (f.direction === 'IN' ? categories.in : categories.out).filter((c) => c !== '管理費收入' && c !== '公共基金提撥');
  return (
    <FormModal title="記一筆收支" onClose={onClose} onSubmit={async () => { await api.post('/ledger', { ...f, amount: Number(f.amount), vendorId: f.vendorId || null }); onSaved(); }}>
      <Field label="收支"><select className="input" value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value, category: (e.target.value === 'IN' ? categories.in : categories.out).filter((c) => c !== '管理費收入' && c !== '公共基金提撥')[0] })}><option value="OUT">支出</option><option value="IN">收入</option></select></Field>
      <Field label="帳戶"><select className="input" value={f.fund} onChange={(e) => setF({ ...f, fund: e.target.value })}><option value="MGMT">管理費帳戶</option><option value="RESERVE">公共基金</option></select></Field>
      <Field label="日期"><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label="科目"><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{cats.map((c) => <option key={c}>{c}</option>)}</select></Field>
      <Field label="金額"><input className="input" type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
      <Field label="廠商"><select className="input" value={f.vendorId} onChange={(e) => setF({ ...f, vendorId: e.target.value })}><option value="">—</option>{(vendors ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
      <Field label="說明" full><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="憑證號碼（發票／收據）" full><input className="input" value={f.voucherNo} onChange={(e) => setF({ ...f, voucherNo: e.target.value })} /></Field>
      {f.direction === 'OUT' && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 sm:col-span-2">支出送出後為「待核准」，由管委會委員核准後才計入帳戶餘額。{f.fund === 'RESERVE' && '動支公共基金應依區分所有權人會議決議或規約辦理。'}</p>}
    </FormModal>
  );
}

function Report({ month }: { month: string }) {
  const { cid } = useAuth();
  const { data: r, error } = useLoad(() => api.get<any>(`/report?month=${month}`).then((x) => x.data), [cid, month]);
  const { data: c } = useLoad(() => api.get<any>('/community').then((x) => x.data), [cid]);
  if (error) return <ErrorBox error={error} />;
  if (!r || !c) return <Loading />;
  const part = (fund: string, dir: string) => r.items.filter((i: any) => i.fund === fund && i.direction === dir);
  const total = (fund: string, dir: string) => part(fund, dir).reduce((s: number, i: any) => s + i.amount, 0);
  const Block = ({ fund }: { fund: 'MGMT' | 'RESERVE' }) => (
    <div className="mb-6">
      <h3 className="font-bold mb-2">{L.fund[fund]}</h3>
      <table className="w-full text-sm border border-gray-200">
        <tbody>
          <tr className="bg-gray-50"><td className="px-3 py-1.5">上月結存</td><td className="px-3 py-1.5 text-right num">{money(r.opening[fund === 'MGMT' ? 'mgmt' : 'reserve'])}</td></tr>
          {part(fund, 'IN').map((i: any) => <tr key={'i' + i.category}><td className="px-3 py-1.5 pl-6">收入｜{i.category}</td><td className="px-3 py-1.5 text-right num">{money(i.amount)}</td></tr>)}
          <tr><td className="px-3 py-1.5 font-semibold">本月收入合計</td><td className="px-3 py-1.5 text-right num font-semibold">{money(total(fund, 'IN'))}</td></tr>
          {part(fund, 'OUT').map((i: any) => <tr key={'o' + i.category}><td className="px-3 py-1.5 pl-6">支出｜{i.category}</td><td className="px-3 py-1.5 text-right num">{money(i.amount)}</td></tr>)}
          <tr><td className="px-3 py-1.5 font-semibold">本月支出合計</td><td className="px-3 py-1.5 text-right num font-semibold">{money(total(fund, 'OUT'))}</td></tr>
          <tr className="bg-brand-50"><td className="px-3 py-1.5 font-bold">本月結存</td><td className="px-3 py-1.5 text-right num font-bold">{money(r.closing[fund === 'MGMT' ? 'mgmt' : 'reserve'])}</td></tr>
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="card">
      <div className="flex justify-end mb-2 no-print"><button className="btn-secondary" onClick={() => window.print()}><Printer className="w-4 h-4" />列印月報</button></div>
      {r.pendingApprovals > 0 && <div className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-3 no-print">本月尚有 {r.pendingApprovals} 筆支出待核准，未列入月報。</div>}
      <div className="print-area">
        <h2 className="text-center text-lg font-bold mb-1">{c.name} {month.replace('-', ' 年 ')} 月 財務報告</h2>
        <p className="text-center text-xs text-gray-500 mb-4">依公寓大廈管理條例，公共基金專戶單獨列帳</p>
        <div className="grid md:grid-cols-2 gap-x-6"><Block fund="MGMT" /><Block fund="RESERVE" /></div>
        <div className="text-sm border-t pt-3">
          本月管理費應收 <b className="num">{money(r.collection.billed)}</b> 元，已收 <b className="num">{money(r.collection.paid)}</b> 元，
          收繳率 <b>{r.collection.rate == null ? '-' : `${r.collection.rate}%`}</b>（{r.collection.paidBills} / {r.collection.bills} 戶繳清）。
        </div>
        <div className="mt-10 grid grid-cols-3 text-sm text-center">
          <div>製表：</div><div>財務委員：</div><div>主任委員：</div>
        </div>
      </div>
    </div>
  );
}

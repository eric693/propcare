import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, FileText, Plus, Printer, Upload } from 'lucide-react';
import api from '../api/client';
import { Page } from '../components/Layout';
import HowTo from '../components/HowTo';
import { act, Empty, ErrorBox, Field, Filter, FormModal, Loading, matches, Modal, SearchBox, Stat, Tabs, toast, Toolbar, useLoad } from '../components/ui';
import { BarChart, ChartCard, PieChart } from '../components/charts';
import { useAuth, useCanWrite } from '../context/AuthContext';
import { addDays, addMonth, d10, downloadCsv, L, money, roc, thisMonth, today } from '../lib/format';
import { logExport } from '../lib/exportLog';
import { Bill } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tab = 'bills' | 'payments' | 'arrears' | 'bank';

export default function Fees() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as Tab) || 'bills';
  return (
    <Page title="管理費">
      <HowTo module="fees" />
      <Tabs value={tab} onChange={(t) => setSp({ tab: t })} items={[['bills', '帳單與收款'], ['payments', '收款紀錄'], ['arrears', '欠費與催告'], ['bank', '銀行入帳匯入']]} />
      {tab === 'bills' ? <Bills /> : tab === 'payments' ? <Payments /> : tab === 'arrears' ? <Arrears /> : <BankImport />}
    </Page>
  );
}

function Bills() {
  const { cid } = useAuth();
  const canWrite = useCanWrite();
  const [period, setPeriod] = useState(thisMonth());
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const { data, error, reload } = useLoad(() => api.get<Bill[]>(`/bills?period=${period}`).then((r) => r.data), [cid, period]);
  const [gen, setGen] = useState(false);
  const [paying, setPaying] = useState<Bill | null>(null);
  const [adjust, setAdjust] = useState<Bill | null>(null);
  const bills = data ?? [];
  const shown = bills.filter((b) => (!status || b.status === status) && matches(q, b.unit.label, b.unit.ownerName, b.otherNote, ...b.payments.map((p) => p.receiptNo)));
  const valid = bills.filter((b) => b.status !== 'VOID');
  const billed = valid.reduce((s, b) => s + b.total, 0), paid = valid.reduce((s, b) => s + b.paid, 0);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button className="btn-ghost btn-sm" onClick={() => setPeriod(addMonth(period, -1))}>‹</button>
        <input className="input w-36" type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
        <button className="btn-ghost btn-sm" onClick={() => setPeriod(addMonth(period, 1))}>›</button>
        <Filter value={status} onChange={setStatus} all="全部狀態" options={L.bill} />
        <SearchBox value={q} onChange={setQ} placeholder="搜尋戶別、所有權人、收據號碼" />
        <button className="btn-secondary ml-auto" disabled={!shown.length} onClick={() => downloadCsv(`管理費帳單_${period}`, ['戶別', '所有權人', '管理費', '車位', '其他', '應繳', '已繳', '狀態', '收據'],
          shown.map((b) => [b.unit.label, b.unit.ownerName, b.amountMgmt, b.amountParking, b.amountOther, b.total, b.paid, L.bill[b.status], b.payments.map((p) => p.receiptNo).join(' ')]), logExport)}><Download className="w-4 h-4" />匯出 Excel</button>
        {canWrite && <button className="btn-primary" onClick={() => setGen(true)}><Plus className="w-4 h-4" />開立 {period} 帳單</button>}
      </div>
      <ErrorBox error={error} />
      {!data ? <Loading /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
            <Stat label="應收" value={money(billed)} sub={`${valid.length} 張帳單`} />
            <Stat label="已收" value={money(paid)} tone="ok" sub={`收繳率 ${billed ? Math.round(paid / billed * 1000) / 10 : 0}%`} />
            <Stat label="未收" value={money(billed - paid)} tone={billed - paid ? 'warn' : undefined} sub={`${valid.filter((b) => b.status !== 'PAID').length} 戶`} />
            <Stat label="已繳清" value={valid.filter((b) => b.status === 'PAID').length} sub="戶" />
          </div>
          {!bills.length ? <Empty>{period} 還沒有帳單。{canWrite && '按右上角「開立帳單」，系統會依每戶坪數與車位自動計算。'}</Empty> : (
            <div className="card p-0 overflow-x-auto"><table className="tbl">
              <thead><tr><th>戶別</th><th>所有權人</th><th className="text-right">管理費</th><th className="text-right">車位</th><th className="text-right">其他</th><th className="text-right">應繳</th><th className="text-right">已繳</th><th>狀態</th><th>收據</th><th /></tr></thead>
              <tbody>{!shown.length && <tr><td colSpan={10} className="text-center text-gray-400 py-6">沒有符合條件的帳單</td></tr>}{shown.map((b) => (
                <tr key={b.id}>
                  <td className="font-semibold">{b.unit.label}</td><td className="text-gray-500">{b.unit.ownerName}</td>
                  <td className="num text-right">{money(b.amountMgmt)}</td><td className="num text-right">{b.amountParking ? money(b.amountParking) : '-'}</td>
                  <td className="num text-right" title={b.otherNote}>{b.amountOther ? money(b.amountOther) : '-'}</td>
                  <td className="num text-right font-semibold">{money(b.total)}</td><td className="num text-right">{money(b.paid)}</td>
                  <td><span className={L.billCls[b.status]}>{L.bill[b.status]}</span></td>
                  <td className="text-xs text-gray-400">{b.payments.map((p) => p.receiptNo).join(' ')}</td>
                  <td className="text-right whitespace-nowrap">{canWrite && b.status !== 'VOID' && <>
                    {b.status !== 'PAID' && <button className="btn-primary btn-sm" onClick={() => setPaying(b)}>收款</button>}
                    <button className="btn-ghost btn-sm" onClick={() => setAdjust(b)}>調整</button>
                  </>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      )}
      {gen && <GenerateForm period={period} onClose={() => setGen(false)} onSaved={reload} />}
      {paying && <PayForm bill={paying} onClose={() => setPaying(null)} onSaved={reload} />}
      {adjust && <AdjustForm bill={adjust} onClose={() => setAdjust(null)} onSaved={reload} />}
    </>
  );
}

function GenerateForm({ period, onClose, onSaved }: { period: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ period, otherAmount: '0', otherNote: '', notify: true });
  return (
    <FormModal title="開立帳單" submitText="開立" onClose={onClose} onSubmit={async () => {
      const r = await api.post('/bills/generate', { ...f, otherAmount: Number(f.otherAmount) });
      toast(`已開立 ${r.data.created} 張${r.data.skipped ? `，${r.data.skipped} 戶已開過略過` : ''}${r.data.notified ? `，LINE 通知 ${r.data.notified} 人` : ''}`);
      onSaved();
    }}>
      <Field label="期別"><input className="input" type="month" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} /></Field>
      <Field label="每戶加收其他費用（選填）"><input className="input" type="number" value={f.otherAmount} onChange={(e) => setF({ ...f, otherAmount: e.target.value })} /></Field>
      <Field label="其他費用說明" full><input className="input" placeholder="例如：年度消防檢修分攤" value={f.otherNote} onChange={(e) => setF({ ...f, otherNote: e.target.value })} /></Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.notify} onChange={(e) => setF({ ...f, notify: e.target.checked })} />開立後 LINE 通知已綁定的住戶</label>
      <p className="text-xs text-gray-400 sm:col-span-2">金額依社區設定（每坪單價或每戶固定）加上該戶車位清潔費；已開過帳單的戶別不會重複開立。</p>
    </FormModal>
  );
}

function PayForm({ bill, onClose, onSaved }: { bill: Bill; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ amount: String(bill.total - bill.paid), method: 'TRANSFER', paidDate: today(), note: '' });
  return (
    <FormModal title={`收款：${bill.unit.label} ${bill.period}`} submitText="登錄收款" onClose={onClose} onSubmit={async () => {
      const r = await api.post('/payments', { billId: bill.id, ...f, amount: Number(f.amount) });
      toast(`已收款，收據 ${r.data.payment.receiptNo}${r.data.reserve ? `（提撥公共基金 ${money(r.data.reserve)} 元）` : ''}`);
      onSaved();
    }}>
      <div className="sm:col-span-2 text-sm bg-gray-50 rounded-xl p-3">應繳 <b>{money(bill.total)}</b> 元，已繳 {money(bill.paid)}，未繳 <b className="text-red-600">{money(bill.total - bill.paid)}</b> 元</div>
      <Field label="收款金額"><input className="input" type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
      <Field label="收款方式"><select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(L.method).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="收款日"><input className="input" type="date" value={f.paidDate} onChange={(e) => setF({ ...f, paidDate: e.target.value })} /></Field>
      <Field label="備註（如匯款末 5 碼）"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
    </FormModal>
  );
}

function AdjustForm({ bill, onClose, onSaved }: { bill: Bill; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ amountOther: String(bill.amountOther), otherNote: bill.otherNote });
  return (
    <FormModal title={`調整帳單：${bill.unit.label} ${bill.period}`} onClose={onClose} onSubmit={async () => {
      await api.put(`/bills/${bill.id}`, { amountOther: Number(f.amountOther), otherNote: f.otherNote }); onSaved();
    }}>
      <Field label="其他費用"><input className="input" type="number" value={f.amountOther} onChange={(e) => setF({ ...f, amountOther: e.target.value })} /></Field>
      <Field label="說明"><input className="input" value={f.otherNote} onChange={(e) => setF({ ...f, otherNote: e.target.value })} /></Field>
      {bill.paid === 0 && <div className="sm:col-span-2 flex flex-wrap gap-2 items-center">
        {!bill.payments.length && <button className="btn-danger btn-sm" onClick={async () => { if (confirm('刪除這張帳單？（開錯帳單時使用）')) { if (await act(() => api.delete(`/bills/${bill.id}`), '已刪除')) { onSaved(); onClose(); } } }}>刪除帳單</button>}
        <button className="btn-ghost btn-sm text-red-500" onClick={async () => { if (confirm('作廢這張帳單？作廢後保留紀錄。')) { if (await act(() => api.put(`/bills/${bill.id}`, { void: true }), '已作廢')) { onSaved(); onClose(); } } }}>作廢帳單</button>
        <span className="text-xs text-gray-400">曾有收款紀錄的帳單只能作廢，不能刪除。</span>
      </div>}
    </FormModal>
  );
}

function Payments() {
  const { cid } = useAuth();
  const canWrite = useCanWrite();
  const [from, setFrom] = useState(`${thisMonth()}-01`);
  const [to, setTo] = useState(today());
  const { data, error, reload } = useLoad(() => api.get<any[]>(`/payments?from=${from}&to=${to}`).then((r) => r.data), [cid, from, to]);
  const [q, setQ] = useState('');
  const [method, setMethod] = useState('');
  const [state, setState] = useState('');
  const [edit, setEdit] = useState<any>(null);
  const shown = (data ?? []).filter((p) => (!method || p.method === method) && (!state || (state === 'void' ? p.voided : !p.voided))
    && matches(q, p.receiptNo, p.unit.label, p.bill.period, p.note, p.createdBy));
  const valid = shown.filter((p) => !p.voided);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input className="input w-40" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><span className="text-gray-400">～</span>
        <input className="input w-40" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <div className="text-sm text-gray-500 ml-auto">有效 {valid.length} 筆・<b className="text-gray-800">{money(valid.reduce((s, p) => s + p.amount, 0))}</b> 元</div>
      </div>
      <Toolbar>
        <SearchBox value={q} onChange={setQ} placeholder="搜尋收據號碼、戶別、期別、備註" />
        <Filter value={method} onChange={setMethod} all="全部收款方式" options={L.method} />
        <Filter value={state} onChange={setState} all="含作廢" options={[['ok', '有效'], ['void', '已作廢']]} />
        <button className="btn-secondary" disabled={!shown.length} onClick={() => downloadCsv('收款紀錄', ['收款日', '收據號碼', '戶別', '期別', '方式', '金額', '經手', '備註', '狀態'],
          shown.map((p) => [d10(p.paidDate), p.receiptNo, p.unit.label, p.bill.period, L.method[p.method], p.amount, p.createdBy, p.note, p.voided ? '已作廢' : '有效']), logExport)}><Download className="w-4 h-4" />匯出 Excel</button>
      </Toolbar>
      <ErrorBox error={error} />
      {!data ? <Loading /> : !shown.length ? <Empty>{data.length ? '沒有符合條件的收款' : '這段期間沒有收款'}</Empty> : (
        <div className="card p-0 overflow-x-auto"><table className="tbl">
          <thead><tr><th>收款日</th><th>收據號碼</th><th>戶別</th><th>期別</th><th>方式</th><th className="text-right">金額</th><th>經手</th><th>備註</th><th /></tr></thead>
          <tbody>{shown.map((p) => (
            <tr key={p.id} className={p.voided ? 'opacity-50 line-through' : ''}>
              <td>{d10(p.paidDate)}</td><td className="font-mono text-xs">{p.receiptNo}</td><td>{p.unit.label}</td><td>{p.bill.period}</td><td>{L.method[p.method]}</td>
              <td className="num text-right font-semibold">{money(p.amount)}</td><td className="text-gray-500">{p.createdBy}</td><td className="text-xs text-gray-500 no-underline">{p.note}</td>
              <td className="text-right whitespace-nowrap">{canWrite && !p.voided && <button className="btn-ghost btn-sm" onClick={() => setEdit({ id: p.id, receiptNo: p.receiptNo, method: p.method, paidDate: d10(p.paidDate), note: p.note })}>編輯</button>}{canWrite && !p.voided && <button className="btn-ghost btn-sm text-red-500" onClick={async () => {
                const reason = prompt(`作廢收據 ${p.receiptNo}（${money(p.amount)} 元）的原因：`);
                if (reason) { await act(() => api.post(`/payments/${p.id}/void`, { reason }), '已作廢'); reload(); }
              }}>作廢</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {edit && (
        <FormModal title={`修改收款 ${edit.receiptNo}`} onClose={() => setEdit(null)} onSubmit={async () => { await api.put(`/payments/${edit.id}`, { method: edit.method, paidDate: edit.paidDate, note: edit.note }); reload(); }}>
          <Field label="收款方式"><select className="input" value={edit.method} onChange={(e) => setEdit({ ...edit, method: e.target.value })}>{Object.entries(L.method).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="收款日"><input className="input" type="date" value={edit.paidDate} onChange={(e) => setEdit({ ...edit, paidDate: e.target.value })} /></Field>
          <Field label="備註" full><input className="input" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></Field>
          <p className="text-xs text-gray-400 sm:col-span-2">金額收錯請「作廢」這筆收款後重新登錄，帳才不會亂。</p>
        </FormModal>
      )}
    </>
  );
}

/** 欠費帳齡：依欠繳期數分組（3 期以上即逾二期） */
function ArrearsAging({ rows }: { rows: any[] }) {
  const buckets = [['欠 1 期', 1, 1], ['欠 2 期', 2, 2], ['欠 3 期以上', 3, Infinity]] as const;
  const groups = buckets.map(([label, lo, hi]) => {
    const g = rows.filter((r) => r.count >= lo && r.count <= hi);
    return { label, units: g.length, amount: g.reduce((s, r) => s + r.amount, 0) };
  });
  return (
    <div className="grid lg:grid-cols-2 gap-4 mb-3">
      <ChartCard title="欠費帳齡：戶數" sub="依欠繳期數分組；3 期以上即逾二期">
        <BarChart labels={groups.map((g) => g.label)} series={[{ name: '戶數', values: groups.map((g) => g.units) }]} format={(v) => `${v} 戶`} height={180} integer />
      </ChartCard>
      <ChartCard title="欠費帳齡：金額" sub="各組未繳金額（元）">
        <PieChart items={groups.map((g) => ({ label: g.label, value: g.amount }))} format={money} />
      </ChartCard>
    </div>
  );
}

function Arrears() {
  const { cid } = useAuth();
  const canWrite = useCanWrite();
  const { data, error, reload } = useLoad(() => api.get<any[]>('/arrears').then((r) => r.data), [cid]);
  const { data: community } = useLoad(() => api.get<any>('/community').then((r) => r.data), [cid]);
  const [letter, setLetter] = useState<any>(null);
  const [paying, setPaying] = useState<any>(null);
  const [dun, setDun] = useState<any>(null);
  const { data: dunnings, reload: reloadDun } = useLoad(() => api.get<any[]>('/dunnings').then((r) => r.data), [cid]);
  const lastDun = (unitId: string) => { const d = (dunnings ?? []).find((x) => x.unitId === unitId); return d ? `${d10(d.date)} ${d.method}${d.deliveredDate ? '・已送達' : ''}` : ''; };
  const [q, setQ] = useState('');
  const [level, setLevel] = useState('');
  const all = data ?? [];
  const rows = all.filter((r) => (!level || (level === 'over2' ? r.overTwo : !r.overTwo)) && matches(q, r.label, r.ownerName, ...r.contacts.flatMap((c: any) => [c.name, c.phone])));
  return (
    <>
      <ErrorBox error={error} />
      {!data ? <Loading /> : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <Stat label="欠費戶數" value={all.length} />
            <Stat label="達催告標準" value={all.filter((r) => r.overTwo).length} tone={all.some((r) => r.overTwo) ? 'bad' : undefined} sub={community ? `欠滿 ${community.arrearsPeriods} 期${community.arrearsAmount ? `或達 ${money(community.arrearsAmount)} 元` : ''}（社區設定）` : ''} />
            <Stat label="欠費總額" value={money(all.reduce((s, r) => s + r.amount, 0))} />
          </div>
          {all.length > 0 && <ArrearsAging rows={all} />}
          <Toolbar count={`顯示 ${rows.length} / ${all.length} 戶`}>
            <SearchBox value={q} onChange={setQ} placeholder="搜尋戶別、所有權人、聯絡人、電話" />
            <Filter value={level} onChange={setLevel} all="全部欠費戶" options={[['over2', '達催告標準'], ['under', '未達催告標準']]} />
            <button className="btn-secondary" disabled={!rows.length} onClick={() => downloadCsv('欠費名單', ['戶別', '所有權人', '聯絡人', '欠繳期別', '期數', '欠費金額', '達催告標準', '最近催告'],
              rows.map((r) => [r.label, r.ownerName, r.contacts.map((c: any) => `${c.name} ${c.phone}`).join('、'), r.periods.join('、'), r.count, r.amount, r.overTwo ? '是' : '', lastDun(r.unitId)]), logExport)}><Download className="w-4 h-4" />匯出 Excel</button>
          </Toolbar>
          {!rows.length ? <Empty>{all.length ? '沒有符合條件的欠費戶' : '目前沒有逾期未繳的戶別'}</Empty> : (
            <div className="card p-0 overflow-x-auto"><table className="tbl">
              <thead><tr><th>戶別</th><th>所有權人</th><th>聯絡人</th><th>欠繳期別</th><th className="text-right">欠費金額</th><th>催告紀錄</th><th /></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.unitId}>
                  <td className="font-semibold">{r.label}{r.overTwo && <span className="badge-bad ml-1.5">可催告</span>}</td><td>{r.ownerName}</td>
                  <td className="text-xs text-gray-500">{r.contacts.map((c: any) => `${c.name} ${c.phone}`).join('、')}</td>
                  <td className="text-xs">{r.periods.join('、')}<span className="text-gray-400">（{r.count} 期）</span></td>
                  <td className="num text-right font-semibold text-red-600">{money(r.amount)}</td>
                  <td className="text-xs whitespace-nowrap"><button className="text-brand hover:underline" onClick={() => setDun(r)}>{lastDun(r.unitId) || (canWrite ? '登錄' : '—')}</button></td>
                  <td className="text-right whitespace-nowrap">
                    {canWrite && <button className="btn-primary btn-sm" onClick={() => setPaying(r)}>整戶收款</button>}
                    <button className="btn-ghost btn-sm" onClick={() => setLetter(r)}><FileText className="w-3.5 h-3.5" />催告函</button>
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      )}
      {paying && (
        <UnitPayForm row={paying} onClose={() => setPaying(null)} onSaved={reload} />
      )}
      {letter && community && <NoticeLetter row={letter} community={community} onClose={() => setLetter(null)} onLog={() => { setDun({ ...letter, addNew: true }); setLetter(null); }} />}
      {dun && <DunningModal row={dun} onClose={() => setDun(null)} onChanged={reloadDun} />}
    </>
  );
}

function UnitPayForm({ row, onClose, onSaved }: { row: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ amount: String(row.amount), method: 'TRANSFER', paidDate: today(), note: '' });
  return (
    <FormModal title={`整戶收款：${row.label}`} submitText="登錄收款" onClose={onClose} onSubmit={async () => {
      const r = await api.post('/payments/unit', { unitId: row.unitId, ...f, amount: Number(f.amount) });
      toast(`已收款，開立收據 ${r.data.receipts.length} 張`); onSaved();
    }}>
      <div className="sm:col-span-2 text-sm bg-gray-50 rounded-xl p-3">欠繳 {row.periods.join('、')}，共 <b className="text-red-600">{money(row.amount)}</b> 元。收款會從最舊的期別開始沖銷。</div>
      <Field label="收款金額"><input className="input" type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
      <Field label="收款方式"><select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(L.method).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="收款日"><input className="input" type="date" value={f.paidDate} onChange={(e) => setF({ ...f, paidDate: e.target.value })} /></Field>
      <Field label="備註"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
    </FormModal>
  );
}

/** 催告函（公寓大廈管理條例第 21 條）：列印後以存證信函或掛號寄送 */
function NoticeLetter({ row, community, onClose, onLog }: { row: any; community: any; onClose: () => void; onLog: () => void }) {
  const canWrite = useCanWrite();
  const t = roc(today());
  const deadline = roc(addDays(today(), 14));
  return (
    <Modal title="催告函預覽" wide onClose={onClose} footer={<><button className="btn-ghost" onClick={onClose}>關閉</button>{canWrite && <button className="btn-secondary" onClick={onLog}>登錄寄送紀錄</button>}<button className="btn-primary" onClick={() => window.print()}><Printer className="w-4 h-4" />列印</button></>}>
      <div className="print-area text-[15px] leading-8 text-gray-800">
        <h2 className="text-center text-xl font-bold tracking-widest mb-4">催 告 函</h2>
        <p>受文者：{row.ownerName || row.label + ' 區分所有權人'}（{row.label}）</p>
        <p>發文者：{community.name}管理委員會</p>
        <p>發文日期：{t}</p>
        <p className="mt-4">主旨：請於 {deadline} 前繳清積欠之管理費 {money(row.amount)} 元，逾期將依法訴請給付。</p>
        <p className="mt-2">說明：</p>
        <ol className="list-decimal pl-8">
          <li>台端為本社區 {row.label} 之區分所有權人，迄今積欠 {row.periods.join('、')} 共 {row.count} 期管理費，合計新台幣 {money(row.amount)} 元。</li>
          <li>依公寓大廈管理條例第 21 條規定，區分所有權人積欠應繳納之費用已逾二期或達相當金額，經定相當期間催告仍不給付者，管理委員會得訴請法院命其給付應繳之金額及遲延利息。</li>
          <li>請於收受本函後，於 {deadline} 前繳納至：{row.vaCode ? `${community.vaBank} 虛擬帳號 ${row.vaCode}` : community.bankInfo || '本社區管理中心'}。如已繳納，請持收據至管理中心核對，並請忽略本函。</li>
        </ol>
        <div className="mt-10 text-right">{community.name}管理委員會<br />主任委員　　　　　　（簽章）</div>
      </div>
      <p className="text-xs text-gray-500 mt-3 no-print">法院審理時會要求證明催告已送達本人，建議以雙掛號或存證信函寄送，寄出後按「登錄寄送紀錄」保存掛號號碼與回執簽收日。</p>
    </Modal>
  );
}

/** 催告寄送與送達紀錄（訴請法院時用來證明「經定相當期間催告」） */
function DunningModal({ row, onClose, onChanged }: { row: any; onClose: () => void; onChanged: () => void }) {
  const canWrite = useCanWrite();
  const { data, reload } = useLoad(() => api.get<any[]>(`/dunnings?unitId=${row.unitId}`).then((r) => r.data), [row.unitId]);
  const [edit, setEdit] = useState<any>(row.addNew ? {} : null);
  const done = () => { reload(); onChanged(); };
  if (edit) return <DunningForm row={row} d={edit} onClose={() => (row.addNew && !edit.id ? onClose() : setEdit(null))} onSaved={() => { done(); if (row.addNew) onClose(); }} />;
  return (
    <Modal title={`催告紀錄：${row.label}`} wide onClose={onClose} footer={canWrite && <button className="btn-primary" onClick={() => setEdit({})}><Plus className="w-4 h-4" />登錄寄送</button>}>
      {!data ? <Loading /> : !data.length ? <Empty>還沒有催告紀錄</Empty> : (
        <table className="tbl"><thead><tr><th>寄出日</th><th>方式／號碼</th><th>金額／期別</th><th>送達</th><th /></tr></thead>
          <tbody>{data.map((d) => (
            <tr key={d.id}>
              <td className="whitespace-nowrap">{d10(d.date)}</td><td>{d.method}<div className="text-xs text-gray-400">{d.trackingNo}</div></td>
              <td className="num">{money(d.amount)}<div className="text-xs text-gray-400">{d.periods}</div></td>
              <td>{d.deliveredDate ? <span className="badge-ok">{d10(d.deliveredDate)} {d.receivedBy}</span> : <span className="badge-warn">待確認</span>}</td>
              <td className="text-right whitespace-nowrap">{canWrite && <>
                <button className="btn-ghost btn-sm" onClick={() => setEdit(d)}>編輯</button>
                <button className="btn-ghost btn-sm text-gray-400" onClick={() => confirm('刪除這筆催告紀錄？') && act(() => api.delete(`/dunnings/${d.id}`), '已刪除').then(done)}>刪除</button>
              </>}</td>
            </tr>
          ))}</tbody></table>
      )}
    </Modal>
  );
}

function DunningForm({ row, d, onClose, onSaved }: { row: any; d: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ date: d10(d.date) || today(), method: d.method ?? '雙掛號', trackingNo: d.trackingNo ?? '', deliveredDate: d10(d.deliveredDate), receivedBy: d.receivedBy ?? '', amount: String(d.amount ?? row.amount ?? 0), periods: d.periods ?? (row.periods ?? []).join('、'), note: d.note ?? '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <FormModal title={`${d.id ? '編輯' : '登錄'}催告寄送：${row.label}`} onClose={onClose} onSubmit={async () => {
      const body = { ...f, unitId: row.unitId, amount: Number(f.amount) };
      if (d.id) await api.put(`/dunnings/${d.id}`, body); else await api.post('/dunnings', body);
      onSaved();
    }}>
      <Field label="寄出日"><input className="input" type="date" value={f.date} onChange={set('date')} /></Field>
      <Field label="寄送方式"><select className="input" value={f.method} onChange={set('method')}>{['雙掛號', '掛號', '存證信函', '親送', '公告'].map((m) => <option key={m}>{m}</option>)}</select></Field>
      <Field label="掛號／存證信函號碼"><input className="input" value={f.trackingNo} onChange={set('trackingNo')} /></Field>
      <Field label="催告金額"><input className="input" type="number" value={f.amount} onChange={set('amount')} /></Field>
      <Field label="欠繳期別" full><input className="input" value={f.periods} onChange={set('periods')} /></Field>
      <Field label="送達日（回執簽收日）"><input className="input" type="date" value={f.deliveredDate} onChange={set('deliveredDate')} /></Field>
      <Field label="簽收人" hint="法院會確認是否由本人簽收"><input className="input" value={f.receivedBy} onChange={set('receivedBy')} /></Field>
      <Field label="備註" full><input className="input" value={f.note} onChange={set('note')} /></Field>
    </FormModal>
  );
}

/** 銀行入帳匯入：貼上或選擇銀行網銀下載的入帳明細，依虛擬帳號自動比對戶別並沖銷 */
function BankImport() {
  const { cid } = useAuth();
  const canWrite = useCanWrite();
  const { data: community } = useLoad(() => api.get<any>('/community').then((r) => r.data), [cid]);
  const { data: units } = useLoad(() => api.get<any[]>('/units').then((r) => r.data), [cid]);
  const [text, setText] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const preview = async () => {
    setBusy(true); setResult({});
    try {
      const r = (await api.post('/bank/preview', { text })).data.rows;
      setRows(r); setPick(Object.fromEntries(r.map((x: any) => [x.hash, !x.problem])));
    } catch (e) { act(() => Promise.reject(e)); }
    setBusy(false);
  };
  const apply = async () => {
    const chosen = (rows ?? []).filter((r) => pick[r.hash] && r.unitId && !r.duplicate && !result[r.hash]?.ok);
    if (!chosen.length) return toast('沒有勾選可入帳的資料', true);
    if (!confirm(`確定入帳 ${chosen.length} 筆、共 ${money(chosen.reduce((s, r) => s + r.amount, 0))} 元？`)) return;
    setBusy(true);
    try {
      const r = (await api.post('/bank/apply', { rows: chosen })).data.results;
      setResult({ ...result, ...Object.fromEntries(r.map((x: any) => [x.hash, x])) });
      const ok = r.filter((x: any) => x.ok).length;
      toast(`入帳成功 ${ok} 筆${r.length - ok ? `，失敗 ${r.length - ok} 筆` : ''}`, r.length - ok > 0);
    } catch (e) { act(() => Promise.reject(e)); }
    setBusy(false);
  };
  if (!community) return <Loading />;
  return (
    <>
      {!community.vaPrefix ? (
        <div className="card text-sm text-gray-600 mb-3">尚未設定虛擬帳號。請物業公司管理員到「社區設定」填入銀行核發的虛擬帳號前綴，系統會替每戶產生專屬的繳費帳號（住戶專區與催告函會顯示），之後就能在這裡匯入入帳明細自動銷帳。</div>
      ) : (
        <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 mb-3">虛擬帳號：{community.vaBank} 前綴 {community.vaPrefix}，每戶 14 碼。從網路銀行下載「虛擬帳號入帳明細」（CSV 或 Excel 另存 CSV），貼上或選擇檔案即可；支援民國或西元日期，同一筆入帳不會重複入帳。</div>
      )}
      {canWrite && <div className="card mb-3">
        <textarea className="input font-mono text-xs" rows={6} placeholder={'交易日期,摘要,存入金額,虛擬帳號\n115/10/28,ATM轉入,3500,12300000000001'} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <label className="btn-secondary cursor-pointer"><Upload className="w-4 h-4" />選擇 CSV 檔<input type="file" accept=".csv,.txt" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await readText(f)); }} /></label>
          <button className="btn-primary ml-auto" disabled={!text.trim() || busy} onClick={preview}>比對戶別</button>
        </div>
      </div>}
      {rows && (!rows.length ? <Empty>沒有讀到入帳資料</Empty> : (
        <>
          <div className="card p-0 overflow-x-auto"><table className="tbl">
            <thead><tr><th /><th>日期</th><th className="text-right">金額</th><th>帳號／摘要</th><th>戶別</th><th className="text-right">該戶欠費</th><th>結果</th></tr></thead>
            <tbody>{rows.map((r) => {
              const res = result[r.hash];
              return (
                <tr key={r.hash} className={r.duplicate ? 'opacity-50' : ''}>
                  <td><input type="checkbox" disabled={r.duplicate || !!res?.ok} checked={!!pick[r.hash]} onChange={(e) => setPick({ ...pick, [r.hash]: e.target.checked })} /></td>
                  <td className="whitespace-nowrap">{r.date || '?'}</td><td className="num text-right font-semibold">{money(r.amount)}</td>
                  <td className="text-xs font-mono">{r.account}<div className="text-gray-400 font-sans">{r.memo}</div></td>
                  <td><select className="input py-1 w-auto" value={r.unitId ?? ''} disabled={r.duplicate || !!res?.ok} onChange={(e) => { const u = units?.find((x) => x.id === e.target.value); setRows(rows.map((x) => x.hash === r.hash ? { ...x, unitId: u?.id ?? null, unitLabel: u?.label ?? '', problem: u ? '' : x.problem } : x)); setPick({ ...pick, [r.hash]: !!u }); }}>
                    <option value="">請選擇</option>{(units ?? []).map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</select></td>
                  <td className="num text-right">{r.unitId ? money(r.owed) : ''}</td>
                  <td className="text-xs">{res ? (res.ok ? <span className="badge-ok" title={res.receipts.join('、')}>已入帳，開立 {res.receipts.length} 張收據</span> : <span className="badge-bad">{res.error}</span>) : r.problem ? <span className={r.duplicate ? 'badge-mute' : 'badge-warn'}>{r.problem}</span> : r.amount > r.owed ? <span className="badge-warn">超過欠費，需人工處理</span> : <span className="badge-info">可入帳</span>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
          {canWrite && <div className="flex justify-end mt-3"><button className="btn-primary" disabled={busy} onClick={apply}>入帳勾選的資料</button></div>}
        </>
      ))}
    </>
  );
}

/** 讀取 CSV：先試 UTF-8，出現亂碼時改用 Big5（台灣網銀常見） */
async function readText(f: File) {
  const buf = await f.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buf);
  return utf8.includes('\uFFFD') ? new TextDecoder('big5').decode(buf) : utf8;
}

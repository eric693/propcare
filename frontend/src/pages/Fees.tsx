import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileText, Plus, Printer } from 'lucide-react';
import api from '../api/client';
import { Page } from '../components/Layout';
import HowTo from '../components/HowTo';
import { act, Empty, ErrorBox, Field, Filter, FormModal, Loading, matches, Modal, SearchBox, Stat, Tabs, toast, Toolbar, useLoad } from '../components/ui';
import { useAuth, useCanWrite } from '../context/AuthContext';
import { addMonth, d10, L, money, thisMonth, today } from '../lib/format';
import { Bill } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tab = 'bills' | 'payments' | 'arrears';

export default function Fees() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as Tab) || 'bills';
  return (
    <Page title="管理費">
      <HowTo module="fees" />
      <Tabs value={tab} onChange={(t) => setSp({ tab: t })} items={[['bills', '帳單與收款'], ['payments', '收款紀錄'], ['arrears', '欠費與催告']]} />
      {tab === 'bills' ? <Bills /> : tab === 'payments' ? <Payments /> : <Arrears />}
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
        {canWrite && <button className="btn-primary ml-auto" onClick={() => setGen(true)}><Plus className="w-4 h-4" />開立 {period} 帳單</button>}
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

function Arrears() {
  const { cid } = useAuth();
  const canWrite = useCanWrite();
  const { data, error, reload } = useLoad(() => api.get<any[]>('/arrears').then((r) => r.data), [cid]);
  const { data: community } = useLoad(() => api.get<any>('/community').then((r) => r.data), [cid]);
  const [letter, setLetter] = useState<any>(null);
  const [paying, setPaying] = useState<any>(null);
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
            <Stat label="逾二期" value={all.filter((r) => r.overTwo).length} tone={all.some((r) => r.overTwo) ? 'bad' : undefined} sub="可依條例第 21 條催告" />
            <Stat label="欠費總額" value={money(all.reduce((s, r) => s + r.amount, 0))} />
          </div>
          <Toolbar count={`顯示 ${rows.length} / ${all.length} 戶`}>
            <SearchBox value={q} onChange={setQ} placeholder="搜尋戶別、所有權人、聯絡人、電話" />
            <Filter value={level} onChange={setLevel} all="全部欠費戶" options={[['over2', '逾二期'], ['under', '二期以內']]} />
          </Toolbar>
          {!rows.length ? <Empty>{all.length ? '沒有符合條件的欠費戶' : '目前沒有逾期未繳的戶別'}</Empty> : (
            <div className="card p-0 overflow-x-auto"><table className="tbl">
              <thead><tr><th>戶別</th><th>所有權人</th><th>聯絡人</th><th>欠繳期別</th><th className="text-right">欠費金額</th><th /></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.unitId}>
                  <td className="font-semibold">{r.label}{r.overTwo && <span className="badge-bad ml-1.5">逾二期</span>}</td><td>{r.ownerName}</td>
                  <td className="text-xs text-gray-500">{r.contacts.map((c: any) => `${c.name} ${c.phone}`).join('、')}</td>
                  <td className="text-xs">{r.periods.join('、')}<span className="text-gray-400">（{r.count} 期）</span></td>
                  <td className="num text-right font-semibold text-red-600">{money(r.amount)}</td>
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
      {letter && community && <NoticeLetter row={letter} community={community} onClose={() => setLetter(null)} />}
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
function NoticeLetter({ row, community, onClose }: { row: any; community: any; onClose: () => void }) {
  const t = today();
  const deadline = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  return (
    <Modal title="催告函預覽" wide onClose={onClose} footer={<><button className="btn-ghost" onClick={onClose}>關閉</button><button className="btn-primary" onClick={() => window.print()}><Printer className="w-4 h-4" />列印</button></>}>
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
          <li>請於收受本函後，於 {deadline} 前繳納至：{community.bankInfo || '本社區管理中心'}。如已繳納，請持收據至管理中心核對，並請忽略本函。</li>
        </ol>
        <div className="mt-10 text-right">{community.name}管理委員會<br />主任委員　　　　　　（簽章）</div>
      </div>
    </Modal>
  );
}

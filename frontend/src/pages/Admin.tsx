import { ReactNode, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import api from '../api/client';
import { Page } from '../components/Layout';
import HowTo from '../components/HowTo';
import { ErrorBox, Field, FormModal, Loading, toast, useLoad } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { L } from '../lib/format';
import { Community } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div className="card mb-4"><h3 className="font-semibold mb-3">{title}</h3><div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{children}</div></div>;
}

/** 社區設定：物業公司管理員可編輯；其他人唯讀 */
export function CommunitySettings() {
  const { cid, user, refresh } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const { data, error } = useLoad(() => api.get<Community>('/community').then((r) => r.data), [cid]);
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setF({ ...data, quorumAttend: +(data.quorumAttend * 100).toFixed(2), quorumPass: +(data.quorumPass * 100).toFixed(2), quorumReAttend: +(data.quorumReAttend * 100).toFixed(2), quorumRePass: +(data.quorumRePass * 100).toFixed(2) }); }, [data]);
  if (error) return <Page title="社區設定"><ErrorBox error={error} /></Page>;
  if (!f) return <Page title="社區設定"><Loading /></Page>;
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const inp = (k: string, type = 'text', step?: string) => <input className="input" type={type} step={step} disabled={!isAdmin} value={f[k] ?? ''} onChange={set(k)} />;
  async function save() {
    setBusy(true);
    try {
      const { id, createdAt, active, ...rest } = f;
      await api.put('/community', { ...rest, quorumAttend: f.quorumAttend / 100, quorumPass: f.quorumPass / 100, quorumReAttend: f.quorumReAttend / 100, quorumRePass: f.quorumRePass / 100 });
      await refresh(); toast('已儲存');
    } catch (e: any) { toast(e.response?.data?.error ?? '儲存失敗', true); }
    setBusy(false);
  }
  return (
    <Page title="社區設定" actions={isAdmin && <button className="btn-primary" onClick={save} disabled={busy}>{busy ? '儲存中…' : '儲存'}</button>}>
      <HowTo module="communities" />
      {!isAdmin && <div className="card text-sm text-gray-500 mb-4">社區設定由物業公司管理員維護，您可以檢視目前的設定。</div>}
      <Section title="基本資料">
        <Field label="社區名稱">{inp('name')}</Field>
        <Field label="地址">{inp('address')}</Field>
        <Field label="管理中心電話">{inp('phone')}</Field>
      </Section>
      <Section title="管理費">
        <Field label="計算方式"><select className="input" disabled={!isAdmin} value={f.feeMode} onChange={set('feeMode')}><option value="AREA">每坪單價 × 坪數</option><option value="FIXED">每戶固定金額</option></select></Field>
        <Field label={f.feeMode === 'AREA' ? '每坪單價（元）' : '每戶月費（元）'}>{inp('feeRate', 'number', '0.1')}</Field>
        <Field label="公共基金提撥比例（%）" hint="依規約；收款時自動記入公共基金帳戶">{inp('reserveRatio', 'number', '0.1')}</Field>
        <Field label="每月繳費期限日">{inp('dueDay', 'number')}</Field>
        <Field label="自動開帳日（0＝不自動）" hint="每月這天 08:00 自動開立當月帳單並 LINE 通知">{inp('autoBillDay', 'number')}</Field>
        <Field label="到期前幾天 LINE 提醒（0＝不提醒）">{inp('remindDaysBefore', 'number')}</Field>
        <Field label="繳費帳戶（顯示於帳單與催告函）" full>{inp('bankInfo')}</Field>
      </Section>
      <Section title="帳務期初">
        <Field label="管理費帳戶期初餘額">{inp('openingMgmt', 'number')}</Field>
        <Field label="公共基金期初餘額">{inp('openingReserve', 'number')}</Field>
        <Field label="期初日期">{inp('openingDate', 'date')}</Field>
      </Section>
      <Section title="區分所有權人會議定額（%）">
        <Field label="出席門檻" hint="第 31 條：人數及比例各 2/3">{inp('quorumAttend', 'number', '0.01')}</Field>
        <Field label="決議門檻" hint="第 31 條：出席者 3/4 同意">{inp('quorumPass', 'number', '0.01')}</Field>
        <div />
        <Field label="重新召集出席門檻" hint="第 32 條：3 人並 1/5">{inp('quorumReAttend', 'number', '0.01')}</Field>
        <Field label="重新召集決議門檻" hint="第 32 條：過半數（須超過）">{inp('quorumRePass', 'number', '0.01')}</Field>
      </Section>
      <Section title="其他">
        <Field label="包裹幾天未領算逾期">{inp('packageOverdueDays', 'number')}</Field>
        <Field label="備註" full>{inp('note')}</Field>
      </Section>
    </Page>
  );
}

export function Accounts() {
  const { user } = useAuth();
  const { data: users, error, reload } = useLoad(() => api.get<any[]>('/users').then((r) => r.data), []);
  const { data: communities } = useLoad(() => api.get<Community[]>('/communities').then((r) => r.data), []);
  const [edit, setEdit] = useState<any>(null);
  if (user?.role !== 'ADMIN') return <Page title="帳號權限"><div className="card text-sm text-gray-500">需要物業公司管理員權限。</div></Page>;
  const cname = (id: string) => communities?.find((c) => c.id === id)?.name ?? '';
  return (
    <Page title="帳號權限" actions={<button className="btn-primary" onClick={() => setEdit({ role: 'MANAGER', active: true, communityIds: [] })}><Plus className="w-4 h-4" />新增帳號</button>}>
      <HowTo module="accounts" />
      <ErrorBox error={error} />
      {!users ? <Loading /> : (
        <div className="card p-0 overflow-x-auto"><table className="tbl">
          <thead><tr><th>姓名</th><th>帳號</th><th>身分</th><th>負責社區</th><th>LINE</th><th>狀態</th><th /></tr></thead>
          <tbody>{users.map((u) => (
            <tr key={u.id} className={u.active ? '' : 'opacity-50'}>
              <td><b>{u.name}</b><div className="text-xs text-gray-400">{u.title}</div></td><td className="font-mono text-xs">{u.username}</td>
              <td><span className={u.role === 'ADMIN' ? 'badge-info' : u.role === 'COMMITTEE' ? 'badge-warn' : 'badge-mute'}>{L.role[u.role]}</span></td>
              <td className="text-xs max-w-xs whitespace-normal">{u.role === 'ADMIN' ? '全部社區' : u.communityIds.map(cname).join('、') || <span className="text-red-500">未指派</span>}</td>
              <td>{u.lineBound ? <span className="badge-ok">已綁定</span> : '-'}</td><td>{u.active ? '啟用' : '停用'}</td>
              <td className="text-right"><button className="btn-ghost btn-sm" onClick={() => setEdit(u)}>編輯</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {edit && (
        <FormModal title={edit.id ? `編輯 ${edit.name}` : '新增帳號'} onClose={() => setEdit(null)} onSubmit={async () => {
          const body: any = { username: edit.username, name: edit.name, role: edit.role, title: edit.title ?? '', phone: edit.phone ?? '', active: edit.active, communityIds: edit.communityIds };
          if (edit.password) body.password = edit.password;
          await (edit.id ? api.put(`/users/${edit.id}`, body) : api.post('/users', body)); reload();
        }}>
          <Field label="姓名"><input className="input" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="職稱"><input className="input" value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="總幹事／財務委員" /></Field>
          <Field label="帳號"><input className="input" value={edit.username ?? ''} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, username: e.target.value })} /></Field>
          <Field label={edit.id ? '新密碼（不改請留空）' : '密碼（至少 8 碼）'}><input className="input" type="password" autoComplete="new-password" value={edit.password ?? ''} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>
          <Field label="身分"><select className="input" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>{Object.entries(L.role).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <label className="flex items-center gap-2 text-sm self-end pb-2"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />啟用</label>
          {edit.role !== 'ADMIN' && (
            <Field label="負責社區" full>
              <div className="grid sm:grid-cols-2 gap-1.5">{(communities ?? []).map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.communityIds.includes(c.id)} onChange={(e) => setEdit({ ...edit, communityIds: e.target.checked ? [...edit.communityIds, c.id] : edit.communityIds.filter((x: string) => x !== c.id) })} />{c.name}</label>
              ))}</div>
            </Field>
          )}
        </FormModal>
      )}
    </Page>
  );
}

/** 我的帳號：個人資料、改密碼、LINE 綁定 */
export function MySettings() {
  const { user, refresh } = useAuth();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [code, setCode] = useState<any>(null);
  if (!user) return null;
  return (
    <Page title="我的帳號">
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="font-semibold mb-2">{user.name}</h3>
          <div className="text-sm text-gray-500">帳號 {user.username}・{L.role[user.role]}</div>
          <h4 className="font-semibold text-sm mt-4 mb-2">修改密碼</h4>
          <input className="input mb-2" type="password" placeholder="目前密碼" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
          <input className="input mb-2" type="password" placeholder="新密碼（至少 8 碼）" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
          <button className="btn-primary" onClick={async () => {
            try { await api.put('/auth/me', pw); setPw({ currentPassword: '', newPassword: '' }); toast('密碼已更新'); } catch (e: any) { toast(e.response?.data?.error ?? '失敗', true); }
          }}>更新密碼</button>
        </div>
        <div className="card">
          <h3 className="font-semibold mb-2">LINE 通知</h3>
          <p className="text-sm text-gray-500 mb-3">綁定後，住戶報修、急件與每週到期事項會傳到您的 LINE。</p>
          {user.lineBound ? <>
            <span className="badge-ok">已綁定</span>
            <button className="btn-ghost btn-sm ml-2" onClick={async () => { await api.delete('/auth/line'); await refresh(); toast('已解除綁定'); }}>解除綁定</button>
          </> : code ? (
            code.lineEnabled
              ? <div className="text-sm">請在 10 分鐘內，把綁定碼 <b className="text-2xl font-mono tracking-widest text-brand">{code.code}</b> 傳給社區的 LINE 官方帳號。</div>
              : <div className="text-sm text-amber-700 bg-amber-50 rounded-lg p-3">系統尚未設定 LINE 官方帳號，請物業公司先申請並設定後再綁定。</div>
          ) : <button className="btn-secondary" onClick={async () => setCode((await api.post('/auth/line/code')).data)}>取得綁定碼</button>}
        </div>
      </div>
    </Page>
  );
}

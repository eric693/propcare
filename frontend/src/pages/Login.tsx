import { FormEvent, useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Home } from 'lucide-react';
import api, { errMsg } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<{ account: string; password: string } | null>(null);
  useEffect(() => { api.get('/auth/demo').then((r) => setDemo(r.data)).catch(() => {}); }, []);
  if (user) return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await login(username, password); nav(from, { replace: true }); } catch (e) { setErr(errMsg(e)); }
    setBusy(false);
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-4 bg-gradient-to-br from-brand-50 to-warm">
      <form onSubmit={submit} className="card w-full max-w-sm p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 bg-brand rounded-xl flex items-center justify-center"><Home className="w-6 h-6 text-white" strokeWidth={2.5} /></div>
          <div><div className="text-lg font-bold">PropCare 物業管家</div><div className="text-xs text-gray-400">物業公司・總幹事・管委會登入</div></div>
        </div>
        <label className="label">帳號</label>
        <input className="input mb-3" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
        <label className="label">密碼</label>
        <input className="input mb-4" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        {err && <div className="text-sm text-red-600 mb-3">{err}</div>}
        <button className="btn-primary w-full py-2.5" disabled={busy}>{busy ? '登入中…' : '登入'}</button>
        {demo && (
          <div className="mt-4 text-xs bg-brand-50 border border-brand-light rounded-xl p-3 leading-relaxed text-gray-600">
            <b className="text-gray-700">示範帳號</b>（虛構社區資料）<br />
            總幹事：{demo.account} / {demo.password}
            <button type="button" className="ml-2 text-brand font-semibold" onClick={() => { setUsername(demo.account); setPassword(demo.password); }}>帶入</button><br />
            管委會委員：committee / committee1234
          </div>
        )}
        <div className="mt-4 flex justify-between text-sm">
          <Link to="/r/login" className="text-brand font-medium">住戶登入 →</Link>
          <Link to="/intro" className="text-gray-400">系統介紹</Link>
        </div>
      </form>
    </div>
  );
}

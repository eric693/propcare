import { Request, Response, NextFunction } from 'express';

// 登入暴力嘗試防護：同一帳號連續失敗 5 次鎖 15 分鐘；同一 IP 5 分鐘內最多 30 次登入請求
const fails = new Map<string, { n: number; until?: number }>();

export function lockedMinutes(key: string): number {
  const a = fails.get(key);
  return a?.until && a.until > Date.now() ? Math.ceil((a.until - Date.now()) / 60000) : 0;
}
export function loginFailed(key: string) {
  if (fails.size > 10000) fails.clear();
  const a = fails.get(key) ?? { n: 0 };
  a.n += 1;
  if (a.n >= 5) { a.until = Date.now() + 15 * 60000; a.n = 0; }
  fails.set(key, a);
}
export function loginSucceeded(key: string) { fails.delete(key); }

const hits = new Map<string, { count: number; reset: number }>();
export function loginRateLimit(req: Request, res: Response, next: NextFunction) {
  const now = Date.now();
  const key = req.ip ?? 'unknown';
  if (hits.size > 20000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  let e = hits.get(key);
  if (!e || e.reset <= now) { e = { count: 0, reset: now + 5 * 60000 }; hits.set(key, e); }
  if (++e.count > 30) {
    res.setHeader('Retry-After', Math.ceil((e.reset - now) / 1000));
    res.status(429).json({ error: '請求過於頻繁，請稍後再試' }); return;
  }
  next();
}

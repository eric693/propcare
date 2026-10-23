import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Community, User } from '@prisma/client';
import { prisma } from '../prisma';
import { config } from '../config';

export interface AuthRequest extends Request {
  user?: User;
  /** 目前操作的社區（由 X-Community 標頭指定，已確認有權限） */
  cid?: string;
  community?: Community;
}

export function signStaffToken(userId: string): string {
  return jwt.sign({ userId, kind: 'staff' }, config.jwtSecret, { expiresIn: '7d' });
}

function bearer(req: Request): string | undefined {
  return req.headers.authorization?.split(' ')[1];
}

/** 員工能管理的社區：ADMIN 全部；其他人看指派 */
export async function communityIdsOf(user: User): Promise<string[]> {
  if (user.role === 'ADMIN') {
    return (await prisma.community.findMany({ where: { active: true }, select: { id: true } })).map((c) => c.id);
  }
  return (await prisma.userCommunity.findMany({
    where: { userId: user.id, community: { active: true } }, select: { communityId: true },
  })).map((r) => r.communityId);
}

export async function requireStaff(req: AuthRequest, res: Response, next: NextFunction) {
  const token = bearer(req);
  if (!token) { res.status(401).json({ error: '請先登入' }); return; }
  let payload: { userId?: string; kind?: string };
  try {
    payload = jwt.verify(token, config.jwtSecret) as typeof payload;
  } catch {
    res.status(401).json({ error: '登入已過期，請重新登入' }); return;
  }
  if (payload.kind !== 'staff' || !payload.userId) { res.status(401).json({ error: '請先登入' }); return; }
  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user || !user.active) { res.status(401).json({ error: '帳號不存在或已停用' }); return; }
  req.user = user;
  next();
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'ADMIN') { res.status(403).json({ error: '需要物業公司管理員權限' }); return; }
  next();
}

/** 社區範圍：所有社區資料 API 都要經過這裡 */
export async function requireCommunity(req: AuthRequest, res: Response, next: NextFunction) {
  const cid = String(req.headers['x-community'] ?? '');
  if (!cid) { res.status(400).json({ error: '請先選擇社區' }); return; }
  if (!(await communityIdsOf(req.user!)).includes(cid)) { res.status(403).json({ error: '沒有這個社區的權限' }); return; }
  req.cid = cid;
  req.community = (await prisma.community.findUnique({ where: { id: cid } }))!;
  next();
}

/** 管委會委員帳號唯讀：只有核准支出與查詢 */
export function canWrite(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role === 'COMMITTEE') { res.status(403).json({ error: '管委會委員帳號為唯讀，僅能查詢與核准支出' }); return; }
  next();
}

export function staffName(req: AuthRequest): string {
  return req.user?.name ?? '';
}

import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../prisma';
import { config } from '../config';
import { AuthRequest, communityIdsOf, signStaffToken } from '../middleware/auth';
import { lockedMinutes, loginFailed, loginSucceeded } from '../middleware/loginGuard';
import { audit } from '../services/common';
import { bindingCode } from '../services/lineService';
import { parse } from '../utils/validate';

export async function login(req: Request, res: Response) {
  const { username, password } = parse(z.object({ username: z.string().trim().toLowerCase(), password: z.string() }), req.body);
  const key = `staff:${username}`;
  const locked = lockedMinutes(key);
  if (locked) { res.status(429).json({ error: `登入失敗次數過多，請 ${locked} 分鐘後再試` }); return; }
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.active || !(await bcrypt.compare(password, user.password))) {
    loginFailed(key);
    res.status(401).json({ error: '帳號或密碼錯誤' }); return;
  }
  loginSucceeded(key);
  await audit(null, { type: 'staff', id: user.id, name: user.name }, '員工登入');
  res.json({ token: signStaffToken(user.id), user: await meOf(user.id) });
}

async function meOf(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const ids = await communityIdsOf(u);
  const communities = await prisma.community.findMany({ where: { id: { in: ids } }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  return {
    id: u.id, username: u.username, name: u.name, role: u.role, title: u.title, phone: u.phone,
    lineBound: Boolean(u.lineUserId), communities, isDemo: config.demo.enabled && u.username === config.demo.account,
  };
}

export async function me(req: AuthRequest, res: Response) {
  res.json(await meOf(req.user!.id));
}

export async function updateMe(req: AuthRequest, res: Response) {
  const b = parse(z.object({
    name: z.string().trim().min(1, '請填寫姓名').max(50).optional(),
    phone: z.string().trim().max(30).optional(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8, '新密碼至少 8 碼').optional(),
  }), req.body);
  const u = req.user!;
  const isDemo = config.demo.enabled && u.username === config.demo.account;
  const data: { name?: string; phone?: string; password?: string } = {};
  if (b.name) data.name = b.name;
  if (b.phone !== undefined) data.phone = b.phone;
  if (b.newPassword) {
    if (isDemo) { res.status(403).json({ error: '示範帳號不能修改密碼' }); return; }
    if (!b.currentPassword || !(await bcrypt.compare(b.currentPassword, u.password))) { res.status(400).json({ error: '目前密碼不正確' }); return; }
    data.password = await bcrypt.hash(b.newPassword, 10);
  }
  await prisma.user.update({ where: { id: u.id }, data });
  res.json(await meOf(u.id));
}

export function demoAccount(_req: Request, res: Response) {
  res.json(config.demo.enabled ? {
    account: config.demo.account, password: config.demo.password,
    residentPhone: config.demo.residentPhone, residentPassword: config.demo.residentPassword,
  } : null);
}

/** 員工 LINE 綁定碼：傳到官方帳號完成綁定，之後收新報修與到期提醒 */
export async function staffLineCode(req: AuthRequest, res: Response) {
  const { code, expiry } = bindingCode();
  await prisma.user.update({ where: { id: req.user!.id }, data: { lineBindingCode: code, lineBindingExpiry: expiry } });
  res.json({ code, expiry, lineEnabled: config.line.enabled });
}

export async function staffLineUnbind(req: AuthRequest, res: Response) {
  await prisma.user.update({ where: { id: req.user!.id }, data: { lineUserId: null } });
  res.json({ ok: true });
}

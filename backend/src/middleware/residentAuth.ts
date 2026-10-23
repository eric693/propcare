import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Community, Resident, Unit } from '@prisma/client';
import { prisma } from '../prisma';
import { config } from '../config';

export interface ResidentRequest extends Request {
  resident?: Resident & { unit: Unit };
  cid?: string;
  community?: Community;
}

// 住戶端 token 與員工端分開：kind='resident'，員工 token 不能打住戶 API（反之亦然）
export function signResidentToken(residentId: string): string {
  return jwt.sign({ residentId, kind: 'resident' }, config.jwtSecret, { expiresIn: '30d' });
}

export async function requireResident(req: ResidentRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) { res.status(401).json({ error: '請先登入' }); return; }
  let payload: { residentId?: string; kind?: string };
  try {
    payload = jwt.verify(token, config.jwtSecret) as typeof payload;
  } catch {
    res.status(401).json({ error: '登入已過期，請重新登入' }); return;
  }
  if (payload.kind !== 'resident' || !payload.residentId) { res.status(401).json({ error: '請先登入' }); return; }
  const r = await prisma.resident.findUnique({ where: { id: payload.residentId }, include: { unit: true, community: true } });
  if (!r || !r.active || !r.unit.active || !r.community.active) { res.status(401).json({ error: '帳號不存在或已停用' }); return; }
  const { community, ...rest } = r;
  req.resident = rest;
  req.cid = r.communityId;
  req.community = community;
  next();
}

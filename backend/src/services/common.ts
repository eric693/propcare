import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { todayStr } from '../utils/dates';

/** 單號：前綴 + 年月日 + 3 碼流水（如 R20261022001）。用資料庫原子遞增，多人同時開單不會重號。 */
export async function nextDocNo(prefix: string, date = todayStr()): Promise<string> {
  const ymd = date.replace(/-/g, '');
  const row = await prisma.docCounter.upsert({
    where: { prefix_ymd: { prefix, ymd } },
    create: { prefix, ymd, n: 1 },
    update: { n: { increment: 1 } },
  });
  return `${prefix}${ymd}${String(row.n).padStart(3, '0')}`;
}

export async function audit(
  communityId: string | null | undefined,
  actor: { type: 'staff' | 'resident' | 'system'; id?: string; name?: string },
  action: string,
  detail = '',
  tx: Prisma.TransactionClient = prisma,
) {
  await tx.auditLog.create({
    data: { communityId: communityId ?? null, actorType: actor.type, actorId: actor.id ?? null, actorName: actor.name ?? '', action, detail: detail.slice(0, 500) },
  });
}

/** 取件碼：4 位數字，同社區待領包裹中不重複 */
export async function newPickupCode(communityId: string): Promise<string> {
  const used = new Set((await prisma.package.findMany({
    where: { communityId, status: 'WAITING' }, select: { pickupCode: true },
  })).map((p) => p.pickupCode));
  for (let i = 0; i < 50; i++) {
    const c = String(Math.floor(1000 + Math.random() * 9000));
    if (!used.has(c)) return c;
  }
  return String(Date.now()).slice(-6);
}

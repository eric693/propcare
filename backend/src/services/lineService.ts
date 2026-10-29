import * as line from '@line/bot-sdk';
import { prisma } from '../prisma';
import { config } from '../config';

// LINE 官方帳號推播。未設定憑證時所有函式直接回傳 0／false，不影響其他功能。

let client: line.messagingApi.MessagingApiClient | null = null;
function getClient() {
  if (!config.line.enabled) return null;
  if (!client) client = new line.messagingApi.MessagingApiClient({ channelAccessToken: config.line.token });
  return client;
}

async function push(to: string, text: string): Promise<boolean> {
  const cl = getClient();
  if (!cl) return false;
  try {
    await cl.pushMessage({ to, messages: [{ type: 'text', text: text.slice(0, 4900) }] });
    return true;
  } catch (e) {
    console.error('[line] push', e);
    return false;
  }
}

/** 推給單一 LINE 使用者（測試發送用） */
export const pushTo = push;

/** 推給一戶所有已綁定 LINE 的住戶，回傳成功人數 */
export async function notifyUnit(unitId: string, text: string): Promise<number> {
  const rs = await prisma.resident.findMany({ where: { unitId, active: true, lineUserId: { not: null } }, select: { lineUserId: true } });
  let n = 0;
  for (const r of rs) if (await push(r.lineUserId!, text)) n++;
  return n;
}

/** 推給整個社區已綁定的住戶（公告用） */
export async function notifyCommunity(communityId: string, text: string): Promise<number> {
  const rs = await prisma.resident.findMany({ where: { communityId, active: true, lineUserId: { not: null } }, select: { lineUserId: true } });
  const ids = [...new Set(rs.map((r) => r.lineUserId!))];
  let n = 0;
  for (const id of ids) if (await push(id, text)) n++;
  return n;
}

/** 推給負責這個社區的員工（新報修、急件） */
export async function notifyStaff(communityId: string, text: string): Promise<number> {
  const users = await prisma.user.findMany({
    where: {
      active: true, lineUserId: { not: null }, role: { in: ['ADMIN', 'MANAGER'] },
      OR: [{ role: 'ADMIN' }, { communities: { some: { communityId } } }],
    },
    select: { lineUserId: true },
  });
  let n = 0;
  for (const u of users) if (await push(u.lineUserId!, text)) n++;
  return n;
}

/** 6 碼綁定碼，10 分鐘有效 */
export function bindingCode() {
  return { code: String(Math.floor(100000 + Math.random() * 900000)), expiry: new Date(Date.now() + 10 * 60000) };
}

/** Webhook：使用者在官方帳號輸入綁定碼完成綁定 */
export async function handleEvent(event: line.WebhookEvent) {
  const cl = getClient();
  if (!cl || event.type !== 'message' || event.message.type !== 'text' || !event.source.userId) return;
  const text = event.message.text.trim();
  const lineUserId = event.source.userId;
  const reply = (msg: string) => cl.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: msg }] });
  if (!/^\d{6}$/.test(text)) {
    await reply('您好！要接收社區通知，請到住戶專區「LINE 通知」取得 6 碼綁定碼，再傳到這裡。');
    return;
  }
  const now = new Date();
  const r = await prisma.resident.findFirst({ where: { lineBindingCode: text, lineBindingExpiry: { gt: now } }, include: { unit: true, community: true } });
  if (r) {
    await prisma.resident.update({ where: { id: r.id }, data: { lineUserId, lineBindingCode: null, lineBindingExpiry: null } });
    await reply(`綁定成功！${r.community.name} ${r.unit.label} ${r.name}，之後包裹、繳費與社區公告會通知您。`);
    return;
  }
  const u = await prisma.user.findFirst({ where: { lineBindingCode: text, lineBindingExpiry: { gt: now } } });
  if (u) {
    await prisma.user.update({ where: { id: u.id }, data: { lineUserId, lineBindingCode: null, lineBindingExpiry: null } });
    await reply(`綁定成功！${u.name}，之後新報修與到期提醒會通知您。`);
    return;
  }
  await reply('綁定碼錯誤或已過期，請重新取得。');
}

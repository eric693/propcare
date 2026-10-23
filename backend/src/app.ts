import 'dotenv/config';
// 讓 async 路由丟出的錯誤交給下方錯誤處理，而不是讓請求卡住
import 'express-async-errors';
import path from 'path';
import fs from 'fs';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import * as line from '@line/bot-sdk';
import { Prisma } from '@prisma/client';
import routes from './routes/index';
import { config } from './config';
import { HttpError } from './services/feeService';
import { handleEvent } from './services/lineService';
import { startScheduler } from './jobs/scheduler';

const app = express();
app.set('trust proxy', 1);   // nginx 後方，req.ip 取真實 IP（登入限流用）
app.disable('x-powered-by');
app.use(cors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:5173' }));

// LINE webhook 需要原始 body 驗簽，必須在 express.json 之前
if (config.line.enabled) {
  app.post('/api/line/webhook', line.middleware({ channelSecret: config.line.secret }), (req, res) => {
    Promise.all((req.body.events ?? []).map(handleEvent)).catch((e) => console.error('[line webhook]', e));
    res.json({ ok: true });
  });
}

app.use(express.json({ limit: '2mb' }));
app.use('/api', routes);
app.get('/health', (_req, res) => res.json({ ok: true }));

// 前端由後端直接提供（單一 port；nginx 只需反代到這裡）
const FRONTEND_DIST = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST, {
    setHeaders: (res, file) => { if (/(sw\.js|index\.html)$/.test(file)) res.setHeader('Cache-Control', 'no-cache'); },
  }));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
}

// 統一錯誤處理：業務錯誤用自訂狀態碼，資料庫錯誤翻成中文，其餘 500
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return; }
  if (err instanceof SyntaxError && 'body' in (err as object)) { res.status(400).json({ error: '資料格式不正確' }); return; }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') { res.status(409).json({ error: '資料重複，已有相同的紀錄' }); return; }
    if (err.code === 'P2025') { res.status(404).json({ error: '找不到資料' }); return; }
    if (err.code === 'P2003') { res.status(409).json({ error: '這筆資料仍被其他資料使用，無法刪除' }); return; }
    if (err.code === 'P2034') { res.status(409).json({ error: '同時有其他人在操作，請再試一次' }); return; }
  }
  if (err instanceof Prisma.PrismaClientValidationError) { res.status(400).json({ error: '資料格式不正確，請檢查欄位後再試一次' }); return; }
  console.error(`[${req.method} ${req.originalUrl}]`, err);
  res.status(500).json({ error: '伺服器發生錯誤，請稍後再試' });
});

const PORT = Number(process.env.PORT ?? 3390);
if (require.main === module) {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`PropCare API on http://127.0.0.1:${PORT}`);
    startScheduler();
  });
}

export default app;

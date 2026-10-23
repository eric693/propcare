// 每日資料庫備份：pg_dump 壓縮檔存到專案根目錄 backups/，保留最近 14 份。
// 由 cron 呼叫：node /root/project/PropCare/backend/scripts/backup.mjs
// 還原：gunzip -c backups/propcare_XXXX.sql.gz | psql "$DATABASE_URL"
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import { pipeline } from 'stream/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 明確指定 .env 位置：cron 的工作目錄不是專案目錄
dotenv.config({ path: path.join(__dirname, '..', '.env') });
if (!process.env.DATABASE_URL) { console.error(`[${new Date().toISOString()}] 讀不到 DATABASE_URL`); process.exit(1); }
const BACKUP_DIR = path.join(__dirname, '..', '..', 'backups');
const KEEP = 14;

fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.chmodSync(BACKUP_DIR, 0o700); // 含住戶個資與密碼雜湊，只限本機 root 讀取

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dest = path.join(BACKUP_DIR, `propcare_${ts}.sql.gz`);
const dump = spawn('pg_dump', ['--no-owner', '--no-privileges', process.env.DATABASE_URL], { stdio: ['ignore', 'pipe', 'inherit'] });
const exited = new Promise((resolve) => dump.on('close', resolve));
await pipeline(dump.stdout, zlib.createGzip(), fs.createWriteStream(dest, { mode: 0o600 }));
const code = await exited;
if (code !== 0) {
  fs.rmSync(dest, { force: true });
  console.error(`[${new Date().toISOString()}] pg_dump 失敗 (exit ${code})`);
  process.exit(1);
}
const files = fs.readdirSync(BACKUP_DIR).filter((f) => /^propcare_.*\.sql\.gz$/.test(f)).sort();
while (files.length > KEEP) fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
console.log(`[${new Date().toISOString()}] 備份完成 ${path.basename(dest)} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)，共保留 ${files.length} 份`);

/**
 * cert.mjs — 为 mock 腾讯云 API 生成自签证书(仅联调用)。
 *
 * 腾讯云 SDK 强制 https,故 mock 需用 HTTPS + 自签证书。
 * 证书用 openssl 生成,缓存在系统临时目录,不进仓库。
 * SCF 进程侧用 NODE_TLS_REJECT_UNAUTHORIZED=0 接受自签。
 */
import { execSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(os.tmpdir(), 'minist-mock-certs');

export function ensureSelfSigned() {
  fs.mkdirSync(DIR, { recursive: true });
  const keyPath = path.join(DIR, 'key.pem');
  const certPath = path.join(DIR, 'cert.pem');
  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" ` +
        `-days 2 -nodes -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1"`,
      { stdio: 'ignore' },
    );
  }
  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}

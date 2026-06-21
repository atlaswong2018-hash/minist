/**
 * @minist/scf-tencent — SCF Web 函数主入口
 *
 * 腾讯云 SCF「Web 函数」运行模式:平台把 HTTP 请求代理到本进程监听的端口(默认 9000)。
 * 入口即一个普通 express app,无需导出 handler。
 *
 * 本地调试:node src/index.js(可用 PORT=3000 覆盖监听端口)。
 *
 * ⚠️ 防扣费默认值(部署后在控制台或用 /api/admin/set-timeout 固化):
 *   - 内存 128MB
 *   - 超时 60s
 *   - 最大并发实例 1
 *   - 关闭失败重试
 */

'use strict';

const express = require('express');

const corsMiddleware = require('./middleware/cors');
const bodyParserMiddleware = require('./middleware/bodyParser');
const healthRoute = require('./routes/health');
const syncRoute = require('./routes/sync');
const r2Route = require('./routes/r2');
const completionsRoute = require('./routes/completions');
const adminRoute = require('./routes/admin');

const app = express();

// Body 解析:混淆模式(X-Crypto-Data:true)走纯文本,否则走 JSON。
// 必须在 CORS 之后、路由之前(否则 OPTIONS 后的 POST 会被错误解析)。
app.use(corsMiddleware);
app.use(bodyParserMiddleware);

// 路由挂载
app.use(healthRoute);
app.use(syncRoute);
app.use(r2Route);
app.use(completionsRoute);
app.use(adminRoute);

// 404 兜底
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Not Found' });
});

// 统一错误处理
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  // express.json 解析失败会到这里
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: 'JSON 解析失败' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, error: '请求体过大(>10mb)' });
  }
  return res.status(500).json({ success: false, error: (err && err.message) || '内部错误' });
});

const PORT = process.env.PORT || 9000;

if (require.main === module) {
  // 直接 node 运行(本地开发或 SCF Web 函数启动)。
  // ⚠️ SCF Web 函数要求监听 0.0.0.0:9000(不能只监听 127.0.0.1)。
  app.listen(PORT, '0.0.0.0', () => {
    // SCF 环境下日志会进入函数日志;控制 stderr 噪音。
    // eslint-disable-next-line no-console
    console.log('[minist-scf] listening on 0.0.0.0:' + PORT);
  });
}

module.exports = app;

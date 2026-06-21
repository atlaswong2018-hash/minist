/**
 * @minist/scf-tencent — CORS 中间件
 *
 * 允许任意源(手机/微信内置浏览器跨域)。OPTIONS 预检直接返回 200。
 */

'use strict';

const { CORS_HEADERS } = require('../constants');

/**
 * 注入 CORS 响应头;OPTIONS 请求直接 200 返回。
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {Function} next
 */
function corsMiddleware(req, res, next) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.setHeader(k, v);
  }
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  next();
}

module.exports = corsMiddleware;

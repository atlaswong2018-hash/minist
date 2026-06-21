/**
 * @minist/scf-tencent — Body 解析中间件
 *
 * 顺序很关键:必须在 express.json 之前判断 X-Crypto-Data。
 * 混淆模式下 body 是纯 Base64 字符串(不是合法 JSON),
 * 若交给 express.json 会立即 400 解析失败。
 *
 * 策略:
 *   - X-Crypto-Data: true  → 用 express.text() 接收原始字符串,req.body 为字符串
 *   - 否则                  → 正常 express.json()
 *
 * 路由层(crypto.isCryptoEnabled)再据此决定是否 decodeB64。
 */

'use strict';

const express = require('express');
const { HEADERS } = require('../constants');

const jsonParser = express.json({ limit: '10mb' });
const urlencodedParser = express.urlencoded({ extended: true, limit: '10mb' });
const textParser = express.text({ limit: '10mb', type: '*/*' });

/**
 * 根据 X-Crypto-Data 头选择解析器。
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {Function} next
 */
function bodyParserMiddleware(req, res, next) {
  const cryptoHeader = req.get(HEADERS.cryptoData);
  if (cryptoHeader && String(cryptoHeader).toLowerCase() === 'true') {
    // 混淆模式:body 视为纯文本(Base64 字符串),交给路由层解码。
    return textParser(req, res, next);
  }
  // 非 GET 请求且 Content-Type 为表单时走 urlencoded,否则 json。
  const ct = req.get('Content-Type') || '';
  if (ct.includes('application/x-www-form-urlencoded')) {
    return urlencodedParser(req, res, next);
  }
  return jsonParser(req, res, next);
}

module.exports = bodyParserMiddleware;

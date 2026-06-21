/**
 * @minist/scf-tencent — 云端同步路由(COS 备份)
 *
 * 这是云端备份,主存储始终是手机 IndexedDB。COS 仅在用户主动同步或换机时落地。
 * 设计取舍:个人/熟人低频使用,直接整包 JSON putObject,不做增量/合并。
 *
 *   POST /api/sync          上传(可选 Base64 混淆)
 *   GET  /api/sync/:userId  拉取(找不到对象返回空负载)
 *
 * 对象 Key:minist_users/<userId>.json
 */

'use strict';

const express = require('express');
const { ROUTES, HEADERS, SYNC_KEY_PREFIX, EMPTY_SYNC_PAYLOAD } = require('../constants');
const { putObject, getObject, BUCKET, REGION } = require('../cos');
const { decodeB64, isCryptoEnabled } = require('../crypto');

const router = express.Router();

/** 统一错误信封。 */
function fail(res, status, error, code) {
  res.status(status).json({ success: false, error, ...(code ? { code } : {}) });
}

/**
 * POST /api/sync — 上传同步负载。
 * body:SyncPayload(若 X-Crypto-Data:true 则为 Base64 字符串)。
 */
router.post(ROUTES.sync, async (req, res) => {
  try {
    let payload = req.body;
    if (isCryptoEnabled(req.headers)) {
      // 混淆模式:body 是 Base64 字符串,解出真实 JSON。
      const raw = typeof payload === 'string' ? payload : String(payload || '');
      payload = JSON.parse(decodeB64(raw));
    }

    const userId =
      (payload && payload.userId) ||
      req.get(HEADERS.userId) ||
      req.query.userId;

    if (!userId) {
      return fail(res, 400, '缺少 userId(可在 body.userId 或 X-User-Id 头提供)');
    }
    if (!BUCKET) {
      return fail(res, 500, 'COS 未配置:缺少 COS_BUCKET');
    }

    // 补齐服务端权威字段,防止前端漏传。
    payload.userId = userId;
    payload.exportedAt = payload.exportedAt || Date.now();

    const Key = SYNC_KEY_PREFIX + userId + '.json';
    await putObject({
      Bucket: BUCKET,
      Region: REGION,
      Key,
      Body: JSON.stringify(payload),
      ContentType: 'application/json; charset=utf-8',
    });

    return res.json({ success: true, data: { key: Key, exportedAt: payload.exportedAt } });
  } catch (e) {
    return fail(res, 500, '同步上传失败: ' + (e && e.message ? e.message : String(e)));
  }
});

/**
 * GET /api/sync/:userId — 拉取同步负载。
 * 找不到对象返回空负载(前端据此初始化新设备)。
 */
router.get(ROUTES.sync + '/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    if (!userId) return fail(res, 400, '缺少 userId');
    if (!BUCKET) return fail(res, 500, 'COS 未配置:缺少 COS_BUCKET');

    const Key = SYNC_KEY_PREFIX + userId + '.json';
    let data;
    try {
      data = await getObject({ Bucket: BUCKET, Region: REGION, Key });
    } catch (e) {
      // COS 404(对象不存在)→ 返回空负载,而非错误。
      const code = e && (e.statusCode || e.code);
      if (code === 404 || code === 'NoSuchKey' || code === 403) {
        const empty = { ...EMPTY_SYNC_PAYLOAD, userId };
        // 混淆响应:对端若声明 X-Crypto-Data,则整体 Base64。
        if (isCryptoEnabled(req.headers)) {
          return res.type('text/plain').send(Buffer.from(JSON.stringify(empty), 'utf8').toString('base64'));
        }
        return res.json(empty);
      }
      throw e;
    }

    // cos-nodejs-sdk-v5 默认返回 Body 为 Buffer(或流,取决于调用方式;此处用回调式返回 Buffer)。
    let body = data.Body;
    if (Buffer.isBuffer(body)) body = body.toString('utf8');

    if (isCryptoEnabled(req.headers)) {
      return res.type('text/plain').send(Buffer.from(body, 'utf8').toString('base64'));
    }
    // body 可能已是对象(SDK 某些路径会自动解析);统一成字符串交给 express.json 之外的直接返回。
    if (typeof body === 'object') body = JSON.stringify(body);
    res.type('application/json').send(body);
  } catch (e) {
    return fail(res, 500, '同步拉取失败: ' + (e && e.message ? e.message : String(e)));
  }
});

module.exports = router;

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
const { putObject, getObject, listObjects, deleteObject, BUCKET, REGION } = require('../cos');
const { decodeB64, isCryptoEnabled } = require('../crypto');

const router = express.Router();

/** 统一错误信封。 */
function fail(res, status, error, code) {
  res.status(status).json({ success: false, error, ...(code ? { code } : {}) });
}

/** 角色卡对象 key / 前缀(Phase S3 per-card 分片)。 */
const CARD_KEY = (uid, cardId) => `${SYNC_KEY_PREFIX}${uid}/cards/${cardId}.json`;
const CARD_PREFIX = (uid) => `${SYNC_KEY_PREFIX}${uid}/cards/`;

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

// ===== Phase S3:角色卡 per-card 粒度路由 =====
// characters 不再走整包 /api/sync,改为单卡 CRUD,避免全库单对象超限 + 增量同步省额度。
// 注意:这些路由模式(cards/:uid、card/:uid/:cardId)段数与 /:userId 不同,不冲突。

/** GET /api/sync/cards/:uid — 角色卡 id 列表(COS prefix 枚举)。 */
router.get(ROUTES.sync + '/cards/:uid', async (req, res) => {
  try {
    if (!BUCKET) return fail(res, 500, 'COS 未配置:缺少 COS_BUCKET');
    const uid = req.params.uid;
    const prefix = CARD_PREFIX(uid);
    const data = await listObjects({ Bucket: BUCKET, Region: REGION, Prefix: prefix, MaxKeys: 1000 });
    const ids = (data.Contents || [])
      .map((o) => (o.Key || '').slice(prefix.length).replace(/\.json$/, ''))
      .filter(Boolean);
    // 注:MaxKeys 1000,>1000 卡需翻页(marker 循环);当前个人库够用
    return res.json({ success: true, data: { ids } });
  } catch (e) {
    return fail(res, 500, '列卡失败: ' + (e && e.message ? e.message : String(e)));
  }
});

/** GET /api/sync/card/:uid/:cardId — 取单卡(返回原始 JSON 字符串)。 */
router.get(ROUTES.sync + '/card/:uid/:cardId', async (req, res) => {
  try {
    if (!BUCKET) return fail(res, 500, 'COS 未配置:缺少 COS_BUCKET');
    const { uid, cardId } = req.params;
    const data = await getObject({ Bucket: BUCKET, Region: REGION, Key: CARD_KEY(uid, cardId) });
    let body = data.Body;
    if (Buffer.isBuffer(body)) body = body.toString('utf8');
    if (typeof body === 'object') body = JSON.stringify(body);
    return res.json({ success: true, data: { id: cardId, data: body } });
  } catch (e) {
    const code = e && (e.statusCode || e.code);
    if (code === 404 || code === 'NoSuchKey' || code === 403) {
      return fail(res, 404, 'card not found', 'NOT_FOUND');
    }
    return fail(res, 500, '取卡失败: ' + (e && e.message ? e.message : String(e)));
  }
});

/** PUT /api/sync/card/:uid/:cardId — upsert 单卡(body=卡片 JSON)。 */
router.put(ROUTES.sync + '/card/:uid/:cardId', async (req, res) => {
  try {
    if (!BUCKET) return fail(res, 500, 'COS 未配置:缺少 COS_BUCKET');
    const { uid, cardId } = req.params;
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    if (!body || body === '{}') return fail(res, 400, 'empty body');
    await putObject({
      Bucket: BUCKET,
      Region: REGION,
      Key: CARD_KEY(uid, cardId),
      Body: body,
      ContentType: 'application/json; charset=utf-8',
    });
    return res.json({ success: true, data: { id: cardId } });
  } catch (e) {
    return fail(res, 500, '写卡失败: ' + (e && e.message ? e.message : String(e)));
  }
});

/** DELETE /api/sync/card/:uid/:cardId — 删单卡。 */
router.delete(ROUTES.sync + '/card/:uid/:cardId', async (req, res) => {
  try {
    if (!BUCKET) return fail(res, 500, 'COS 未配置:缺少 COS_BUCKET');
    const { uid, cardId } = req.params;
    await deleteObject({ Bucket: BUCKET, Region: REGION, Key: CARD_KEY(uid, cardId) });
    return res.json({ success: true, data: { id: cardId, deleted: true } });
  } catch (e) {
    return fail(res, 500, '删卡失败: ' + (e && e.message ? e.message : String(e)));
  }
});

module.exports = router;

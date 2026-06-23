/**
 * @minist/scf-tencent — COS 预签名直传路由
 *
 * 命名沿用 @minist/shared 的 r2 概念(Cloudflare R2 的等价物),
 * 实现为腾讯云 COS 预签名 PUT URL。
 *
 * 目的:前端直传人物卡 PNG 到用户自己的 COS 桶,流量与存储成本转嫁给用户,
 * 不经过云函数(避免占用 SCF 响应流量配额)。
 *
 *   POST /api/r2/presign  →  { url, headers, key }
 */

'use strict';

const express = require('express');
const crypto = require('crypto');
const { ROUTES } = require('../constants');
const { getObjectUrl, BUCKET, REGION } = require('../cos');

const router = express.Router();

/** 统一错误信封。 */
function fail(res, status, error) {
  res.status(status).json({ success: false, error });
}

/**
 * POST /api/r2/presign
 * body: { key?, contentType?, expires? }
 * 返回预签名 PUT URL,前端直接 fetch(url, { method:'PUT', body:blob, headers })。
 */
router.post(ROUTES.r2 + '/presign', (req, res) => {
  try {
    if (!BUCKET) return fail(res, 500, 'COS 未配置:缺少 COS_BUCKET');

    const body = req.body || {};
    // 前端可指定 key(如 characters/xxx.png),未指定则服务端生成。
    const key = body.key || 'minist_uploads/' + crypto.randomUUID() + '.png';
    const contentType = body.contentType || 'image/png';
    // 预签名有效期(秒),默认 15 分钟,最长 1 小时(COS 限制)。
    const expires = Math.min(Math.max(Number(body.expires) || 900, 60), 3600);

    // cos-nodejs-sdk-v5 getObjectUrl:Method/Sign 指定 HTTP 动词,生成预签名 URL。
    // 官方预签名写法见 cloud.tencent.com/document/product/436/36121。
    // Sign:'PUT' 表示用 PUT 动词签名(也支持 GET/POST/DELETE)。
    const url = getObjectUrl({
      Method: 'PUT',
      Bucket: BUCKET,
      Region: REGION,
      Key: key,
      Sign: 'PUT',
      Expires: expires,
      Headers: { 'Content-Type': contentType },
    });

    return res.json({
      success: true,
      data: {
        url,
        key,
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        expires,
      },
    });
  } catch (e) {
    return fail(res, 500, '预签名生成失败: ' + (e && e.message ? e.message : String(e)));
  }
});

/** 根据 key 后缀推断 Content-Type。 */
function guessContentType(key) {
  const lower = String(key || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

/**
 * GET /api/r2/:key — 下载对象(COS getObject → 回写)。
 * 镜像 CF r2.ts GET,供前端 downloadAsset 取回内容寻址资源(如 cards/<sha256>.png)。
 * 通配 * 捕获 /api/r2/ 之后全部(express 4,req.params[0],含斜杠)。
 * 注:S1 头像场景对象较小,整 buf 回写可接受;超大文件流式见 Phase S5。
 */
router.get(ROUTES.r2 + '/*', async (req, res) => {
  try {
    if (!BUCKET) return fail(res, 500, 'COS 未配置:缺少 COS_BUCKET');
    const key = req.params[0];
    if (!key) return fail(res, 400, 'missing key');
    const data = await getObject({ Bucket: BUCKET, Region: REGION, Key: key });
    const buf = data.Body;
    const ct =
      (data.headers && (data.headers['content-type'] || data.headers['Content-Type'])) ||
      guessContentType(key);
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.isBuffer(buf) ? buf : Buffer.from(buf || ''));
  } catch (e) {
    // getObject 失败(对象不存在 / 权限)统一 404
    return fail(res, 404, '对象不存在或读取失败');
  }
});

module.exports = router;

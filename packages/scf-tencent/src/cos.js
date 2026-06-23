/**
 * @minist/scf-tencent — 腾讯云 COS 客户端(运行时临时凭证惰性单例)
 *
 * 安全红线:绝不硬编码 SecretKey。SCF 运行时会自动注入临时凭证环境变量:
 *   TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY / TENCENTCLOUD_SESSIONTOKEN
 * 这些临时凭证有效期短(随函数生命周期),比持久密钥安全得多。
 *
 * 桶与地域从用户配置的环境变量读取(COS_BUCKET / COS_REGION)。
 * 若未配置,getCos() 返回 null,路由层应据此返回明确错误。
 */

'use strict';

const COS = require('cos-nodejs-sdk-v5');

/** 桶名(从 env 读)。 */
const BUCKET = process.env.COS_BUCKET || '';
/** 地域(默认广州)。 */
const REGION = process.env.COS_REGION || 'ap-guangzhou';

let _instance = null;

/**
 * 惰性初始化 COS 单例。
 * 使用 getAuthorization 回调,把运行时临时凭证透传给 SDK。
 * @returns {object|null} COS 客户端实例;未配置 COS_BUCKET 时返回 null
 */
function getCos() {
  if (_instance) return _instance;
  if (!BUCKET) {
    return null;
  }
  _instance = new COS({
    // SCF 注入的临时凭证;ExpiredTime 仅作 SDK 内部参考,实际过期由 SCF 控制。
    getAuthorization(_options, callback) {
      callback({
        TmpSecretId: process.env.TENCENTCLOUD_SECRETID,
        TmpSecretKey: process.env.TENCENTCLOUD_SECRETKEY,
        SecurityToken: process.env.TENCENTCLOUD_SESSIONTOKEN,
        // SDK 期望秒级时间戳;7200s 是安全上界,SCF 实际生命周期通常远短于此。
        ExpiredTime: Math.floor(Date.now() / 1000) + 7200,
        StartTime: Math.floor(Date.now() / 1000),
      });
    },
  });
  return _instance;
}

/** Promise 包装的 cos.putObject。 */
function putObject(params) {
  const cos = getCos();
  if (!cos) return Promise.reject(new Error('COS 未配置:缺少 COS_BUCKET 环境变量'));
  return new Promise((resolve, reject) => {
    cos.putObject(params, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

/** Promise 包装的 cos.getObject。 */
function getObject(params) {
  const cos = getCos();
  if (!cos) return Promise.reject(new Error('COS 未配置:缺少 COS_BUCKET 环境变量'));
  return new Promise((resolve, reject) => {
    cos.getObject(params, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

/** Promise 包装的 cos.getObjectUrl(生成预签名 URL)。 */
function getObjectUrl(params) {
  const cos = getCos();
  if (!cos) return Promise.reject(new Error('COS 未配置:缺少 COS_BUCKET 环境变量'));
  return cos.getObjectUrl(params);
}

/** Promise 包装的 cos.getBucket(列出对象,Phase S3 角色卡枚举用)。 */
function listObjects(params) {
  const cos = getCos();
  if (!cos) return Promise.reject(new Error('COS 未配置:缺少 COS_BUCKET 环境变量'));
  return new Promise((resolve, reject) => {
    cos.getBucket(params, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

/** Promise 包装的 cos.deleteObject(Phase S3 角色卡删除用)。 */
function deleteObject(params) {
  const cos = getCos();
  if (!cos) return Promise.reject(new Error('COS 未配置:缺少 COS_BUCKET 环境变量'));
  return new Promise((resolve, reject) => {
    cos.deleteObject(params, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

/** Promise 包装的 cos.headObject(Phase S4 dedup-on-upload 存在性探测)。 */
function headObject(params) {
  const cos = getCos();
  if (!cos) return Promise.reject(new Error('COS 未配置:缺少 COS_BUCKET 环境变量'));
  return new Promise((resolve, reject) => {
    cos.headObject(params, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

module.exports = {
  getCos,
  putObject,
  getObject,
  getObjectUrl,
  listObjects,
  deleteObject,
  headObject,
  BUCKET,
  REGION,
};

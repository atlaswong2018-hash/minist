/**
 * @minist/scf-tencent — 方案二:Token 自改超时配置
 *
 *   POST /api/admin/set-timeout  →  SCF「自己改自己」的函数配置
 *
 * 这是腾讯云方案二(个人/熟人)的核心:复用 SCF 运行时注入的临时凭证
 * 初始化 ScfClient,UpdateFunctionConfiguration 把超时/内存/并发等防爆产配置固化。
 * 免备案、免 CAM 跨账号授权,适合个人自用或熟人小范围分享。
 *
 * 鉴权:body.adminToken 或 X-Admin-Token 头,须匹配环境变量 ADMIN_TOKEN。
 * 未配置 ADMIN_TOKEN 时拒绝(默认安全)。
 */

'use strict';

const express = require('express');
const { ROUTES, HEADERS } = require('../constants');

const router = express.Router();

/** 统一错误信封。 */
function fail(res, status, error) {
  res.status(status).json({ success: false, error });
}

/**
 * 初始化 ScfClient(运行时临时凭证)。
 * tencentcloud-sdk-nodejs-scf 暴露 scf.v20180416.Client。
 */
function createScfClient() {
  // SDK 入口:tencentcloud-sdk-nodejs-scf
  const tencentcloud = require('tencentcloud-sdk-nodejs-scf');
  const ScfClient = tencentcloud.scf.v20180416.Client;

  const region = process.env.TENCENTCLOUD_REGION || 'ap-guangzhou';
  // SCF_API_ENDPOINT 仅用于联调/自测,把 SDK 对腾讯 SCF API 的请求指向本地 mock。
  // 生产留空,默认走官方 scf.<region>.tencentcloudapi.com(https)。
  // 腾讯云 SDK 的 endpoint 只接受主机名,协议由 httpProfile.protocol 控制,
  // 故当 SCF_API_ENDPOINT 含 http:// 前缀时拆分设置(允许 http 本地 mock)。
  const httpProfile = { endpoint: 'scf.' + region + '.tencentcloudapi.com' };
  if (process.env.SCF_API_ENDPOINT) {
    const m = process.env.SCF_API_ENDPOINT.match(/^(https?:)\/\/(.+)$/);
    if (m) {
      httpProfile.protocol = m[1] + '//';
      httpProfile.endpoint = m[2].replace(/\/+$/, '');
    } else {
      httpProfile.endpoint = process.env.SCF_API_ENDPOINT;
    }
  }
  const clientConfig = {
    credential: {
      secretId: process.env.TENCENTCLOUD_SECRETID,
      secretKey: process.env.TENCENTCLOUD_SECRETKEY,
      token: process.env.TENCENTCLOUD_SESSIONTOKEN,
    },
    region,
    profile: { httpProfile },
  };
  return new ScfClient(clientConfig);
}

/**
 * POST /api/admin/set-timeout
 * body: { adminToken?, timeout?, memorySize?, namespace? }
 *   - adminToken:鉴权(也可用 X-Admin-Token 头)
 *   - timeout:超时秒数,默认 60
 *   - memorySize:内存 MB,默认 128
 *   - namespace:命名空间,默认 SCF 注入值或 'default'
 */
router.post(ROUTES.adminTimeout, async (req, res) => {
  try {
    // 1. 鉴权
    const expected = process.env.ADMIN_TOKEN;
    if (!expected) {
      return fail(res, 503, '未配置 ADMIN_TOKEN,自改接口禁用(默认安全)');
    }
    const provided = (req.body && req.body.adminToken) || req.get(HEADERS.adminToken);
    if (!provided || provided !== expected) {
      return res.status(403).json({ success: false, error: '管理员 Token 无效' });
    }

    // 2. 取目标配置(防爆产默认值)
    const body = req.body || {};
    const FunctionName =
      process.env.TENCENTCLOUD_FUNCTIONNAME ||
      body.functionName;
    if (!FunctionName) {
      return fail(res, 500, '无法解析当前函数名(TENCENTCLOUD_FUNCTIONNAME 缺失)');
    }
    const Namespace = process.env.TENCENTCLOUD_NAMESPACE || body.namespace || 'default';
    const Timeout = Math.min(Math.max(Number(body.timeout) || 60, 3), 900);
    const MemorySize = Math.min(Math.max(Number(body.memorySize) || 128, 64), 3072);

    // 3. 调 SCF API 自改
    const client = createScfClient();
    const params = {
      FunctionName,
      Namespace,
      Timeout,
      MemorySize,
    };
    // 实例并发数(InstanceConcurrency)在 UpdateFunctionConfiguration 部分区域支持,
    // 若 SDK 版本不识别该字段会被忽略;此处尽力而为,真正的并发上限也建议在控制台设为 1。
    if (body.instanceConcurrency !== undefined) {
      params.InstanceConcurrentConfig = {
        MaxConcurrency: Math.max(1, Number(body.instanceConcurrency)),
      };
    }

    const result = await client.UpdateFunctionConfiguration(params);
    return res.json({
      success: true,
      data: {
        requestId: result.RequestId,
        FunctionName,
        Namespace,
        Timeout,
        MemorySize,
        // 提醒:并发实例数与重试需在控制台「触发器/函数配置」单独关闭。
        reminder: '并发实例上限设为 1、关闭异步重试需在 SCF 控制台手动确认',
      },
    });
  } catch (e) {
    return fail(res, 500, '自改配置失败: ' + (e && e.message ? e.message : String(e)));
  }
});

module.exports = router;

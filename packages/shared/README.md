# @minist/shared

minist 全栈共享契约包:**路由常量 / 加密协议 / 配置与同步类型 / API 信封 / SSE 解析**。

这是整个 monorepo 的"普通话"——前端酒馆、CF Worker、腾讯云 SCF、部署平台都引用它。
修改本包 = 修改全栈契约。

## 导出

| 模块 | 内容 |
|---|---|
| `types` | `BackendType` `TavernConfig` `SyncPayload` `ChatMessage` `ApiEnvelope` 等 |
| `routes` | `ROUTES` `HEADERS` `CORS_HEADERS` `SSE_HEADERS` `SYNC_VERSION` |
| `crypto` | `encodeBase64` `decodeBase64` `xorEncode` `xorDecode`(UTF-8 安全) |
| `api` | `ok` `err` `unwrap` `parseSseStream` `generateUserId` |

## X-Crypto-Data 混淆协议

免备案场景下,手机↔后端之间的聊天明文用 Base64 混淆为"乱码",规避明文审查。
当请求头 `X-Crypto-Data: true` 时,请求体与响应体均为 Base64。注意:这是**混淆非加密**,
API Key 仍走 HTTPS 的 `Authorization` 头。

## 与腾讯云 SCF 的关系

SCF 包**独立打包上传**到用户腾讯云账号,不能依赖本 monorepo,因此复制了等价常量。
**修改本包路由/加密时,务必同步 `packages/scf-tencent/src/constants.js`**。

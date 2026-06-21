/**
 * @minist/scf-tencent — 健康检查路由
 * GET /api/health → { success:true, data:{ ok:true } }
 */

'use strict';

const express = require('express');
const { ROUTES } = require('../constants');

const router = express.Router();

router.get(ROUTES.health, (_req, res) => {
  res.json({ success: true, data: { ok: true } });
});

module.exports = router;

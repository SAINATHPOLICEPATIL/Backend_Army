import { Router } from 'express';
import { ROLES } from '../config.js';
import { requireRole } from '../middlewares/rbac.js';
import { parsePagination } from '../middlewares/pagination.js';
import { query } from '../db.js';

const router = Router();

// Audit trail - admin only. Append-only; supports time/moderator filters.
router.get('/', requireRole(ROLES.ADMIN), async (req, res, next) => {
  try {
    const { from, to, action, page, pageSize } = req.query;
    const pagination = parsePagination({ page, pageSize: pageSize || 50 });
    const [[{ total }]] = await query(
      `SELECT COUNT(*) AS total FROM audit_logs
       WHERE 1=1
         AND (:from IS NULL OR DATE(created_at) >= :from)
         AND (:to IS NULL OR DATE(created_at) <= :to)
         AND (:action IS NULL OR action = :action)`,
      { from: from || null, to: to || null, action: action || null }
    );
    const [rows] = await query(
      `SELECT id, user_id, username, action, entity, entity_id, details, ip_address, created_at
       FROM audit_logs
       WHERE 1=1
         AND (:from IS NULL OR DATE(created_at) >= :from)
         AND (:to IS NULL OR DATE(created_at) <= :to)
         AND (:action IS NULL OR action = :action)
        ORDER BY id DESC
        LIMIT :pageSize OFFSET :offset`,
      { from: from || null, to: to || null, action: action || null, ...pagination }
    );
    res.json({
      rows,
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      pages: Math.max(1, Math.ceil(total / pagination.pageSize)),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/actions', requireRole(ROLES.ADMIN), async (_req, res, next) => {
  try {
    const [rows] = await query('SELECT DISTINCT action FROM audit_logs ORDER BY action');
    res.json({ actions: rows.map((r) => r.action) });
  } catch (err) {
    next(err);
  }
});

export default router;
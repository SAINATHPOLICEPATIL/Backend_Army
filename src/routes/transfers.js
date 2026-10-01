import { Router } from 'express';
import { ROLES } from '../config.js';
import { requireRole, BadRequestError, ForbiddenError } from '../middlewares/rbac.js';
import { parsePagination, limitClause } from '../middlewares/pagination.js';
import { query } from '../db.js';
import { writeAudit, clientIp } from '../services/audit.js';

const router = Router();

const LIST_SQL = `
SELECT tr.id, tr.quantity, tr.transferred_at, tr.status, tr.notes,
       fb.id AS from_base_id, fb.code AS from_base_code, fb.name AS from_base_name,
       tb.id AS to_base_id, tb.code AS to_base_code, tb.name AS to_base_name,
       a.id AS asset_type_id, a.code AS asset_code, a.name AS asset_name, a.category, a.unit,
       init.username AS initiated_by, appr.username AS approved_by
FROM transfers tr
JOIN bases fb ON fb.id = tr.from_base_id
JOIN bases tb ON tb.id = tr.to_base_id
JOIN asset_types a ON a.id = tr.asset_type_id
LEFT JOIN users init ON init.id = tr.initiated_by
LEFT JOIN users appr ON appr.id = tr.approved_by
WHERE 1=1
  AND (:from IS NULL OR DATE(tr.transferred_at) >= :from)
  AND (:to IS NULL OR DATE(tr.transferred_at) <= :to)
  AND (:fromBaseId IS NULL OR tr.from_base_id = :fromBaseId)
  AND (:toBaseId IS NULL OR tr.to_base_id = :toBaseId)
  AND (:assetTypeId IS NULL OR tr.asset_type_id = :assetTypeId)
  AND (:category IS NULL OR a.category = :category)
  AND (:status IS NULL OR tr.status = :status)`;

const COUNT_SQL = `
SELECT COUNT(*) AS total
FROM transfers tr
JOIN asset_types a ON a.id = tr.asset_type_id
WHERE 1=1
  AND (:from IS NULL OR DATE(tr.transferred_at) >= :from)
  AND (:to IS NULL OR DATE(tr.transferred_at) <= :to)
  AND (:fromBaseId IS NULL OR tr.from_base_id = :fromBaseId)
  AND (:toBaseId IS NULL OR tr.to_base_id = :toBaseId)
  AND (:assetTypeId IS NULL OR tr.asset_type_id = :assetTypeId)
  AND (:category IS NULL OR a.category = :category)
  AND (:status IS NULL OR tr.status = :status)`;

/**
 * Transfers - admin/commander/logistics may view and initiate;
 * approval (PENDING -> COMPLETED) requires admin or the receiving
 * base commander.
 */
router.get('/', requireRole(ROLES.ADMIN, ROLES.BASE_COMMANDER, ROLES.LOGISTICS_OFFICER), async (req, res, next) => {
  try {
    const params = {
      from: req.query.from || null,
      to: req.query.to || null,
      fromBaseId: req.query.from_base_id || null,
      toBaseId: req.query.to_base_id || null,
      assetTypeId: req.query.asset_type_id || null,
      category: req.query.category || null,
      status: req.query.status || null,
    };

    // A single "base" filter means transfers *touching* that base (either
    // direction). Base commanders are always restricted to their own base.
    const baseFilter = req.query.base_id || null;
    const scope = { sql: '', params: {} };
    if (baseFilter) {
      scope.sql += ' AND (tr.from_base_id = :touchBase OR tr.to_base_id = :touchBase)';
      scope.params.touchBase = baseFilter;
    }
    if (req.user.role === ROLES.BASE_COMMANDER) {
      if (params.fromBaseId && Number(params.fromBaseId) !== Number(req.user.base_id)) {
        return res.status(403).json({ error: 'You are restricted to your assigned base' });
      }
      if (params.toBaseId && Number(params.toBaseId) !== Number(req.user.base_id)) {
        return res.status(403).json({ error: 'You are restricted to your assigned base' });
      }
      if (baseFilter && Number(baseFilter) !== Number(req.user.base_id)) {
        return res.status(403).json({ error: 'You are restricted to your assigned base' });
      }
      scope.sql += ' AND (tr.from_base_id = :scopeBase OR tr.to_base_id = :scopeBase)';
      scope.params.scopeBase = req.user.base_id;
    }

    const pagination = parsePagination(req.query);
    const countParams = { ...params, ...scope.params };
    const [[{ total }]] = await query(COUNT_SQL + scope.sql, countParams);
    const [rows] = await query(
      LIST_SQL + scope.sql + ' ORDER BY tr.transferred_at DESC, tr.id DESC' + limitClause(pagination),
      { ...countParams, ...pagination }
    );

    res.json({ rows, page: pagination.page, pageSize: pagination.pageSize, total, pages: Math.max(1, Math.ceil(total / pagination.pageSize)) });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole(ROLES.ADMIN, ROLES.BASE_COMMANDER, ROLES.LOGISTICS_OFFICER), async (req, res, next) => {
  try {
    const { asset_type_id, quantity, from_base_id, to_base_id, notes } = req.body || {};
    if (!asset_type_id || !quantity || quantity <= 0 || !from_base_id || !to_base_id) {
      throw new BadRequestError('asset_type_id, quantity (>0), from_base_id and to_base_id are required');
    }
    if (Number(from_base_id) === Number(to_base_id)) {
      throw new BadRequestError('Source and destination base must differ');
    }
    if (req.user.role === ROLES.BASE_COMMANDER && Number(from_base_id) !== Number(req.user.base_id)) {
      throw new ForbiddenError('Commanders may only transfer assets out of their own base');
    }

    const [[asset]] = await query('SELECT id, code, name FROM asset_types WHERE id = :id', { id: asset_type_id });
    if (!asset) throw new BadRequestError('Unknown asset_type_id');

    const status = req.user.role === ROLES.ADMIN ? 'COMPLETED' : 'PENDING';

    const [result] = await query(
      `INSERT INTO transfers
         (asset_type_id, quantity, from_base_id, to_base_id, initiated_by, approved_by, status, notes)
       VALUES (:asset_type_id, :quantity, :from_base_id, :to_base_id, :initiated_by, :approved_by, :status, :notes)`,
      {
        asset_type_id, quantity, from_base_id, to_base_id,
        initiated_by: req.user.id,
        approved_by: status === 'COMPLETED' ? req.user.id : null,
        status,
        notes: notes ?? null,
      }
    );

    await writeAudit({
      user: req.user,
      action: 'CREATE_TRANSFER',
      entity: 'transfer',
      entityId: result.insertId,
      details: { asset_type_id: asset.code, quantity, from_base_id, to_base_id, status },
      ip: clientIp(req),
    });

    res.status(201).json({ id: result.insertId, status, message: 'Transfer recorded' });
  } catch (err) {
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    if (err instanceof BadRequestError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// Approve / complete a PENDING transfer.
router.patch('/:id/approve', requireRole(ROLES.ADMIN, ROLES.BASE_COMMANDER), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[transfer]] = await query(
      'SELECT * FROM transfers WHERE id = :id', { id }
    );
    if (!transfer) return res.status(404).json({ error: 'Transfer not found' });
    if (transfer.status !== 'PENDING') {
      return res.status(400).json({ error: `Transfer is already ${transfer.status}` });
    }
    if (req.user.role === ROLES.BASE_COMMANDER && Number(req.user.base_id) !== Number(transfer.to_base_id)) {
      throw new ForbiddenError('Only the receiving base commander may approve this transfer');
    }

    await query(
      `UPDATE transfers SET status = 'COMPLETED', approved_by = :approved_by WHERE id = :id`,
      { id, approved_by: req.user.id }
    );

    await writeAudit({
      user: req.user,
      action: 'APPROVE_TRANSFER',
      entity: 'transfer',
      entityId: id,
      details: { from_base_id: transfer.from_base_id, to_base_id: transfer.to_base_id, quantity: transfer.quantity },
      ip: clientIp(req),
    });

    res.json({ message: 'Transfer approved' });
  } catch (err) {
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    next(err);
  }
});

// Cancel a PENDING transfer.
router.patch('/:id/cancel', requireRole(ROLES.ADMIN, ROLES.BASE_COMMANDER, ROLES.LOGISTICS_OFFICER), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[transfer]] = await query('SELECT * FROM transfers WHERE id = :id', { id });
    if (!transfer) return res.status(404).json({ error: 'Transfer not found' });
    if (transfer.status !== 'PENDING') {
      return res.status(400).json({ error: `Cannot cancel a ${transfer.status} transfer` });
    }

    await query(`UPDATE transfers SET status = 'CANCELLED' WHERE id = :id`, { id });
    await writeAudit({
      user: req.user,
      action: 'CANCEL_TRANSFER',
      entity: 'transfer',
      entityId: id,
      ip: clientIp(req),
    });
    res.json({ message: 'Transfer cancelled' });
  } catch (err) {
    next(err);
  }
});

export default router;
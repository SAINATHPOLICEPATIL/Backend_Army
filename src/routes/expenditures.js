import { Router } from 'express';
import { ROLES } from '../config.js';
import { requireRole, baseWhere, assertCanUseBase, ForbiddenError, BadRequestError } from '../middlewares/rbac.js';
import { parsePagination, limitClause } from '../middlewares/pagination.js';
import { query } from '../db.js';
import { writeAudit, clientIp } from '../services/audit.js';

const router = Router();

const LIST_SQL = `
SELECT e.id, e.quantity, e.mission_ref, e.reason, e.expenditure_date,
       e.notes, e.created_at,
       b.id AS base_id, b.code AS base_code, b.name AS base_name,
       a.id AS asset_type_id, a.code AS asset_code, a.name AS asset_name, a.category, a.unit,
       u.username AS created_by
FROM expenditures e
JOIN bases b ON b.id = e.base_id
JOIN asset_types a ON a.id = e.asset_type_id
LEFT JOIN users u ON u.id = e.created_by
WHERE 1=1
  AND (:from IS NULL OR e.expenditure_date >= :from)
  AND (:to IS NULL OR e.expenditure_date <= :to)
  AND (:baseId IS NULL OR e.base_id = :baseId)
  AND (:assetTypeId IS NULL OR e.asset_type_id = :assetTypeId)
  AND (:category IS NULL OR a.category = :category)`;

const COUNT_SQL = `
SELECT COUNT(*) AS total
FROM expenditures e
JOIN asset_types a ON a.id = e.asset_type_id
WHERE 1=1
  AND (:from IS NULL OR e.expenditure_date >= :from)
  AND (:to IS NULL OR e.expenditure_date <= :to)
  AND (:baseId IS NULL OR e.base_id = :baseId)
  AND (:assetTypeId IS NULL OR e.asset_type_id = :assetTypeId)
  AND (:category IS NULL OR a.category = :category)`;

/**
 * Expenditures - admin + base_commander only (logistics officers are
 * excluded from this module).
 */
router.get('/', requireRole(ROLES.ADMIN, ROLES.BASE_COMMANDER), async (req, res, next) => {
  try {
    const scope = baseWhere(req.user, 'e');
    const pagination = parsePagination(req.query);
    const params = {
      from: req.query.from || null,
      to: req.query.to || null,
      baseId: req.query.base_id || null,
      assetTypeId: req.query.asset_type_id || null,
      category: req.query.category || null,
      ...scope.params,
    };

    const [[{ total }]] = await query(COUNT_SQL + scope.sql, params);
    const [rows] = await query(
      LIST_SQL + scope.sql + ' ORDER BY e.expenditure_date DESC, e.id DESC' + limitClause(pagination),
      { ...params, ...pagination }
    );

    res.json({ rows, page: pagination.page, pageSize: pagination.pageSize, total, pages: Math.max(1, Math.ceil(total / pagination.pageSize)) });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole(ROLES.ADMIN, ROLES.BASE_COMMANDER), async (req, res, next) => {
  try {
    const { base_id, asset_type_id, quantity, mission_ref, reason, expenditure_date, notes } = req.body || {};
    if (!base_id || !asset_type_id || !quantity || quantity <= 0 || !reason || !expenditure_date) {
      throw new BadRequestError('base_id, asset_type_id, quantity (>0), reason and expenditure_date are required');
    }
    assertCanUseBase(req.user, base_id);

    const [[asset]] = await query('SELECT id, code, name FROM asset_types WHERE id = :id', { id: asset_type_id });
    if (!asset) throw new BadRequestError('Unknown asset_type_id');

    const [result] = await query(
      `INSERT INTO expenditures
         (base_id, asset_type_id, quantity, mission_ref, reason, expenditure_date, notes, created_by)
       VALUES (:base_id, :asset_type_id, :quantity, :mission_ref, :reason, :expenditure_date, :notes, :created_by)`,
      {
        base_id, asset_type_id, quantity, mission_ref: mission_ref ?? null,
        reason, expenditure_date, notes: notes ?? null, created_by: req.user.id,
      }
    );

    await writeAudit({
      user: req.user,
      action: 'CREATE_EXPENDITURE',
      entity: 'expenditure',
      entityId: result.insertId,
      details: { base_id, asset_type_id: asset.code, quantity, mission_ref, reason, expenditure_date },
      ip: clientIp(req),
    });

    res.status(201).json({ id: result.insertId, message: 'Expenditure recorded' });
  } catch (err) {
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    next(err);
  }
});

export default router;
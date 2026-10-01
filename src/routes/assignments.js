import { Router } from 'express';
import { ROLES } from '../config.js';
import { requireRole, baseWhere, assertCanUseBase, ForbiddenError, BadRequestError } from '../middlewares/rbac.js';
import { parsePagination, limitClause } from '../middlewares/pagination.js';
import { query } from '../db.js';
import { writeAudit, clientIp } from '../services/audit.js';

const router = Router();

const LIST_SQL = `
SELECT asg.id, asg.quantity, asg.assigned_to, asg.personnel_rank AS 'rank',
       asg.assignment_date, asg.notes, asg.created_at,
       b.id AS base_id, b.code AS base_code, b.name AS base_name,
       a.id AS asset_type_id, a.code AS asset_code, a.name AS asset_name, a.category, a.unit,
       u.username AS created_by
FROM assignments asg
JOIN bases b ON b.id = asg.base_id
JOIN asset_types a ON a.id = asg.asset_type_id
LEFT JOIN users u ON u.id = asg.created_by
WHERE 1=1
  AND (:from IS NULL OR asg.assignment_date >= :from)
  AND (:to IS NULL OR asg.assignment_date <= :to)
  AND (:baseId IS NULL OR asg.base_id = :baseId)
  AND (:assetTypeId IS NULL OR asg.asset_type_id = :assetTypeId)
  AND (:category IS NULL OR a.category = :category)`;

const COUNT_SQL = `
SELECT COUNT(*) AS total
FROM assignments asg
JOIN asset_types a ON a.id = asg.asset_type_id
WHERE 1=1
  AND (:from IS NULL OR asg.assignment_date >= :from)
  AND (:to IS NULL OR asg.assignment_date <= :to)
  AND (:baseId IS NULL OR asg.base_id = :baseId)
  AND (:assetTypeId IS NULL OR asg.asset_type_id = :assetTypeId)
  AND (:category IS NULL OR a.category = :category)`;

/**
 * Assignments - admin + base_commander only. Logistics officers are
 * deliberately restricted from this module.
 */
router.get('/', requireRole(ROLES.ADMIN, ROLES.BASE_COMMANDER), async (req, res, next) => {
  try {
    const scope = baseWhere(req.user, 'asg');
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
      LIST_SQL + scope.sql + ' ORDER BY asg.assignment_date DESC, asg.id DESC' + limitClause(pagination),
      { ...params, ...pagination }
    );

    res.json({ rows, page: pagination.page, pageSize: pagination.pageSize, total, pages: Math.max(1, Math.ceil(total / pagination.pageSize)) });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole(ROLES.ADMIN, ROLES.BASE_COMMANDER), async (req, res, next) => {
  try {
    const { base_id, asset_type_id, quantity, assigned_to, rank, assignment_date, notes } = req.body || {};
    if (!base_id || !asset_type_id || !quantity || quantity <= 0 || !assigned_to || !assignment_date) {
      throw new BadRequestError('base_id, asset_type_id, quantity (>0), assigned_to and assignment_date are required');
    }
    assertCanUseBase(req.user, base_id);

    const [[asset]] = await query('SELECT id, code, name FROM asset_types WHERE id = :id', { id: asset_type_id });
    if (!asset) throw new BadRequestError('Unknown asset_type_id');

    const [result] = await query(
      `INSERT INTO assignments
         (base_id, asset_type_id, quantity, assigned_to, personnel_rank, assignment_date, notes, created_by)
       VALUES (:base_id, :asset_type_id, :quantity, :assigned_to, :rank, :assignment_date, :notes, :created_by)`,
      {
        base_id, asset_type_id, quantity, assigned_to, rank: rank ?? null,
        assignment_date, notes: notes ?? null, created_by: req.user.id,
      }
    );

    await writeAudit({
      user: req.user,
      action: 'CREATE_ASSIGNMENT',
      entity: 'assignment',
      entityId: result.insertId,
      details: { base_id, asset_type_id: asset.code, quantity, assigned_to, rank, assignment_date },
      ip: clientIp(req),
    });

    res.status(201).json({ id: result.insertId, message: 'Assignment recorded' });
  } catch (err) {
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    next(err);
  }
});

export default router;
import { Router } from 'express';
import { ROLES } from '../config.js';
import { requireRole, baseWhere, assertCanUseBase, BadRequestError } from '../middlewares/rbac.js';
import { parsePagination, limitClause } from '../middlewares/pagination.js';
import { query } from '../db.js';
import { writeAudit, clientIp } from '../services/audit.js';

const router = Router();

const LIST_SQL = `
SELECT s.id, s.quantity, s.effective_date, s.reference, s.created_at,
       b.id AS base_id, b.code AS base_code, b.name AS base_name,
       a.id AS asset_type_id, a.code AS asset_code, a.name AS asset_name, a.category, a.unit,
       u.username AS created_by
FROM stock_levels s
JOIN bases b ON b.id = s.base_id
JOIN asset_types a ON a.id = s.asset_type_id
LEFT JOIN users u ON u.id = s.created_by
WHERE 1=1
  AND (:from IS NULL OR s.effective_date >= :from)
  AND (:to IS NULL OR s.effective_date <= :to)
  AND (:baseId IS NULL OR s.base_id = :baseId)
  AND (:assetTypeId IS NULL OR s.asset_type_id = :assetTypeId)
  AND (:category IS NULL OR a.category = :category)`;

const COUNT_SQL = `
SELECT COUNT(*) AS total
FROM stock_levels s
JOIN asset_types a ON a.id = s.asset_type_id
WHERE 1=1
  AND (:from IS NULL OR s.effective_date >= :from)
  AND (:to IS NULL OR s.effective_date <= :to)
  AND (:baseId IS NULL OR s.base_id = :baseId)
  AND (:assetTypeId IS NULL OR s.asset_type_id = :assetTypeId)
  AND (:category IS NULL OR a.category = :category)`;

/**
 * Opening balances / stock levels.
 * This is the baseline inventory for a base + asset, and is the floor of the
 * dashboard's Opening Balance metric. Admin sees all bases; base commanders
 * are scoped to their own base. Logistics officers have no access here.
 */
router.get('/', requireRole(ROLES.ADMIN, ROLES.BASE_COMMANDER), async (req, res, next) => {
  try {
    const scope = baseWhere(req.user, 's');
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
      LIST_SQL + scope.sql + ' ORDER BY s.effective_date DESC, s.id DESC' + limitClause(pagination),
      { ...params, ...pagination }
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

router.post('/', requireRole(ROLES.ADMIN, ROLES.BASE_COMMANDER), async (req, res, next) => {
  try {
    const { base_id, asset_type_id, quantity, effective_date, reference, notes } = req.body || {};
    if (!base_id || !asset_type_id || quantity === undefined || quantity === null || quantity === ''
      || !effective_date) {
      throw new BadRequestError('base_id, asset_type_id, quantity and effective_date are required');
    }
    if (Number(quantity) < 0) throw new BadRequestError('quantity cannot be negative');
    assertCanUseBase(req.user, base_id);

    const [[asset]] = await query('SELECT id, code, name FROM asset_types WHERE id = :id', { id: asset_type_id });
    if (!asset) throw new BadRequestError('Unknown asset_type_id');

    const [result] = await query(
      `INSERT INTO stock_levels
         (base_id, asset_type_id, quantity, effective_date, reference, created_by)
       VALUES (:base_id, :asset_type_id, :quantity, :effective_date, :reference, :created_by)`,
      {
        base_id, asset_type_id, quantity: Number(quantity), effective_date,
        reference: reference || notes || null, created_by: req.user.id,
      }
    );

    await writeAudit({
      user: req.user,
      action: 'CREATE_STOCK_LEVEL',
      entity: 'stock_level',
      entityId: result.insertId,
      details: { base_id, asset_type_id: asset.code, quantity: Number(quantity), effective_date },
      ip: clientIp(req),
    });

    res.status(201).json({ id: result.insertId, message: 'Opening balance recorded' });
  } catch (err) {
    next(err);
  }
});

export default router;

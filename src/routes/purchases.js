import { Router } from 'express';
import { ROLES } from '../config.js';
import { requireRole, baseWhere, assertCanUseBase, ForbiddenError, BadRequestError } from '../middlewares/rbac.js';
import { parsePagination, limitClause } from '../middlewares/pagination.js';
import { query } from '../db.js';
import { writeAudit, clientIp } from '../services/audit.js';

const router = Router();

const LIST_SQL = `
SELECT p.id, p.quantity, p.unit_cost, p.total_cost, p.vendor,
       p.receipt_number, p.purchase_date, p.notes, p.created_at,
       b.id AS base_id, b.code AS base_code, b.name AS base_name,
       a.id AS asset_type_id, a.code AS asset_code, a.name AS asset_name, a.category,
       u.username AS created_by
FROM purchases p
JOIN bases b ON b.id = p.base_id
JOIN asset_types a ON a.id = p.asset_type_id
LEFT JOIN users u ON u.id = p.created_by
WHERE 1=1
  AND (:from IS NULL OR p.purchase_date >= :from)
  AND (:to IS NULL OR p.purchase_date <= :to)
  AND (:baseId IS NULL OR p.base_id = :baseId)
  AND (:assetTypeId IS NULL OR p.asset_type_id = :assetTypeId)
  AND (:category IS NULL OR a.category = :category)`;

const COUNT_SQL = `
SELECT COUNT(*) AS total
FROM purchases p
JOIN asset_types a ON a.id = p.asset_type_id
WHERE 1=1
  AND (:from IS NULL OR p.purchase_date >= :from)
  AND (:to IS NULL OR p.purchase_date <= :to)
  AND (:baseId IS NULL OR p.base_id = :baseId)
  AND (:assetTypeId IS NULL OR p.asset_type_id = :assetTypeId)
  AND (:category IS NULL OR a.category = :category)`;

/**
 * Purchases - accessible to admin, base_commander (own base data)
 * and logistics_officer (who are limited to purchases & transfers).
 */
router.get('/', requireRole(ROLES.ADMIN, ROLES.BASE_COMMANDER, ROLES.LOGISTICS_OFFICER), async (req, res, next) => {
  try {
    const scope = baseWhere(req.user, 'p');
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
      LIST_SQL + scope.sql + ' ORDER BY p.purchase_date DESC, p.id DESC' + limitClause(pagination),
      { ...params, ...pagination }
    );

    res.json({ rows, page: pagination.page, pageSize: pagination.pageSize, total, pages: Math.max(1, Math.ceil(total / pagination.pageSize)) });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole(ROLES.ADMIN, ROLES.BASE_COMMANDER, ROLES.LOGISTICS_OFFICER), async (req, res, next) => {
  try {
    const { base_id, asset_type_id, quantity, unit_cost, total_cost, vendor, receipt_number, purchase_date, notes } = req.body || {};
    if (!base_id || !asset_type_id || !quantity || quantity <= 0 || !purchase_date) {
      throw new BadRequestError('base_id, asset_type_id, quantity (>0) and purchase_date are required');
    }
    assertCanUseBase(req.user, base_id, { allowLogistics: true });

    const [[asset]] = await query('SELECT id, code, name FROM asset_types WHERE id = :id', { id: asset_type_id });
    if (!asset) throw new BadRequestError('Unknown asset_type_id');

    const [result] = await query(
      `INSERT INTO purchases
         (base_id, asset_type_id, quantity, unit_cost, total_cost, vendor, receipt_number, purchase_date, notes, created_by)
       VALUES (:base_id, :asset_type_id, :quantity, :unit_cost, :total_cost, :vendor, :receipt_number, :purchase_date, :notes, :created_by)`,
      {
        base_id, asset_type_id, quantity,
        unit_cost: unit_cost ?? null,
        total_cost: total_cost ?? null,
        vendor: vendor ?? null,
        receipt_number: receipt_number ?? null,
        purchase_date, notes: notes ?? null,
        created_by: req.user.id,
      }
    );

    await writeAudit({
      user: req.user,
      action: 'CREATE_PURCHASE',
      entity: 'purchase',
      entityId: result.insertId,
      details: { base_id, asset_type_id: asset.code, quantity, total_cost, vendor, receipt_number, purchase_date },
      ip: clientIp(req),
    });

    res.status(201).json({ id: result.insertId, message: 'Purchase recorded' });
  } catch (err) {
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    next(err);
  }
});

export default router;
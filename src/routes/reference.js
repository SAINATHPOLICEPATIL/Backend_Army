import { Router } from 'express';
import { ROLES } from '../config.js';
import { requireRole } from '../middlewares/rbac.js';
import { query } from '../db.js';

const router = Router();

// Reference/lookup data used by dropdowns and filters.

router.get('/bases', requireRole(ROLES.ADMIN, ROLES.BASE_COMMANDER, ROLES.LOGISTICS_OFFICER), async (req, res, next) => {
  try {
    const [rows] = await query(
      'SELECT id, code, name, location FROM bases ORDER BY name'
    );
    res.json({ rows });
  } catch (err) {
    next(err);
  }
});

router.get('/asset-types', requireRole(ROLES.ADMIN, ROLES.BASE_COMMANDER, ROLES.LOGISTICS_OFFICER), async (req, res, next) => {
  try {
    const { category } = req.query;
    const [rows] = await query(
      'SELECT id, code, name, category, unit FROM asset_types WHERE is_active = 1 AND (:category IS NULL OR category = :category) ORDER BY category, name',
      { category: category || null }
    );
    res.json({ rows });
  } catch (err) {
    next(err);
  }
});

router.get('/categories', requireRole(ROLES.ADMIN, ROLES.BASE_COMMANDER, ROLES.LOGISTICS_OFFICER), async (_req, res, next) => {
  try {
    res.json({ categories: ['WEAPON', 'VEHICLE', 'AMMUNITION', 'EQUIPMENT'] });
  } catch (err) {
    next(err);
  }
});

export default router;
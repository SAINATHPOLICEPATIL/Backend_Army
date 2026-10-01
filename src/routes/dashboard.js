import { Router } from 'express';
import { ROLES } from '../config.js';
import { requireRole, scopeForUser } from '../middlewares/rbac.js';
import { getSummary, getNetMovementDetails } from '../services/balance.js';

const router = Router();

function scopeFilters(req) {
  const filters = {
    from: req.query.from,
    to: req.query.to,
    baseId: req.query.base_id,
    assetTypeId: req.query.asset_type_id,
    category: req.query.category,
  };
  const scope = scopeForUser(req.user);
  if (scope.base_id) filters.baseId = scope.base_id;
  return filters;
}

router.get('/summary', requireRole(ROLES.ADMIN, ROLES.BASE_COMMANDER, ROLES.LOGISTICS_OFFICER), async (req, res, next) => {
  try {
    const result = await getSummary(scopeFilters(req));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/net-movement', requireRole(ROLES.ADMIN, ROLES.BASE_COMMANDER, ROLES.LOGISTICS_OFFICER), async (req, res, next) => {
  try {
    const details = await getNetMovementDetails(scopeFilters(req));
    res.json(details);
  } catch (err) {
    next(err);
  }
});

export default router;
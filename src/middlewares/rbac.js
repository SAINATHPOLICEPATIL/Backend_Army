import { ROLES } from '../config.js';

const ROLE_RANK = {
  [ROLES.LOGISTICS_OFFICER]: 1,
  [ROLES.BASE_COMMANDER]: 2,
  [ROLES.ADMIN]: 3,
};

export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message);
    this.status = 403;
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.status = 404;
  }
}

export class BadRequestError extends Error {
  constructor(message = 'Bad request') {
    super(message);
    this.status = 400;
  }
}

/** Restrict a route to a set of roles. */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions for this operation' });
    }
    next();
  };
}

/**
 * Base-level data scoping helper.
 * Admins see everything. Base commanders and logistics officers are
 * constrained to their assigned base (commanders) via the returned scope.
 */
export function scopeForUser(user) {
  if (!user) return {};
  if (user.role === ROLES.ADMIN) return {};
  if (user.role === ROLES.BASE_COMMANDER) {
    if (!user.base_id) throw new ForbiddenError('Commander account has no assigned base');
    return { base_id: user.base_id };
  }
  return {}; // logistics officers are not auto-scoped to a single base
}

/**
 * Validate that a payload's base_id is permitted for the user.
 * Admins: any base. Commanders: only their own base.
 */
export function assertCanUseBase(user, baseId, { allowLogistics = false } = {}) {
  if (!baseId) return;
  if (user.role === ROLES.ADMIN) return;
  if (user.role === ROLES.BASE_COMMANDER && Number(baseId) === Number(user.base_id)) return;
  if (user.role === ROLES.LOGISTICS_OFFICER && allowLogistics) return;
  throw new ForbiddenError('You are restricted to your assigned base');
}

/**
 * For GET list routes: return the WHERE fragment + params that scope
 * results to the user's permitted base. Admin => no filter.
 */
export function baseWhere(user, alias = '') {
  const scope = scopeForUser(user);
  if (!scope.base_id) return { sql: '', params: {} };
  const prefix = alias ? `${alias}.` : '';
  return { sql: ` AND ${prefix}base_id = :scope_base_id`, params: { scope_base_id: scope.base_id } };
}
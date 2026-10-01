import { query } from '../db.js';

/**
 * Append-only audit logging. Every domain write and every significant
 * request is recorded here for accountability/forensics. Records are
 * never updated or deleted by the application.
 */
export async function writeAudit({
  user = null,
  action,
  entity = null,
  entityId = null,
  details = null,
  ip = null,
}) {
  try {
    await query(
      `INSERT INTO audit_logs (user_id, username, action, entity, entity_id, details, ip_address)
       VALUES (:userId, :username, :action, :entity, :entityId, :details, :ip)`,
      {
        userId: user?.id ?? null,
        username: user?.username ?? null,
        action,
        entity,
        entityId,
        details: details ? JSON.stringify(details) : null,
        ip,
      }
    );
  } catch (err) {
    // Logging must never break a business transaction.
    console.error('[audit] failed to write audit record:', err.message);
  }
}

export function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || null;
}
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

/**
 * Security headers. The API serves JSON only, so we can lock the policy down
 * tightly (no framing, no sniffing, strict referrer policy).
 */
export function securityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
  });
}

/**
 * Brute-force protection for credential endpoints: 10 failed logins per
 * 15 minutes per IP.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in a few minutes.' },
});

/** Gentler limit for the broader API surface. */
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

/** Sample/placeholder secrets that must never reach production. */
const WEAK_SECRETS = new Set([
  'insecure-dev-secret-change-me',
  'change-me-in-production-please-use-a-long-random-string',
  'change-me',
  'secret',
]);

/** Refuse to boot in production with the sample JWT secret. */
export function assertProductionConfig(config) {
  const secret = String(config.jwtSecret || '').trim();
  const isDefault = !secret || WEAK_SECRETS.has(secret) || secret.length < 16;
  if (process.env.NODE_ENV === 'production' && isDefault) {
    throw new Error('JWT_SECRET must be set to a strong random value (min 16 chars) in production');
  }
  if (isDefault) {
    console.warn('[security] WARNING: using the default development JWT_SECRET. Set a strong JWT_SECRET before deploying.');
  }
}

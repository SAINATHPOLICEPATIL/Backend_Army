import { writeAudit, clientIp } from '../services/audit.js';

/**
 * Records every API call in the audit trail (method, path, authenticated
 * actor, status code). Domain routes additionally write detailed CREATE /
 * UPDATE records via writeAudit() in their handlers.
 */
export async function requestLogger(req, res, next) {
  const startedAt = Date.now();
  res.on('finish', async () => {
    if (req.path.startsWith('/api')) {
      await writeAudit({
        user: req.user || null,
        action: 'API_CALL',
        entity: `${req.method} ${req.baseUrl}${req.path}`,
        details: { status: res.statusCode, durationMs: Date.now() - startedAt },
        ip: clientIp(req),
      });
    }
  });
  next();
}

export function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);
  if (res.headersSent) return;
  const message = status >= 500 ? 'Internal server error' : err.message;
  res.status(status).json({ error: message });
}

export function notFound(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}
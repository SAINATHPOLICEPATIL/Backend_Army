import express from 'express';
import cors from 'cors';
import { currentUser } from './middlewares/auth.js';
import { requestLogger, errorHandler, notFound } from './middlewares/logging.js';
import { securityHeaders, authRateLimiter, apiRateLimiter } from './middlewares/security.js';

import authRoutes from './routes/auth.js';
import referenceRoutes from './routes/reference.js';
import dashboardRoutes from './routes/dashboard.js';
import purchaseRoutes from './routes/purchases.js';
import transferRoutes from './routes/transfers.js';
import assignmentRoutes from './routes/assignments.js';
import expenditureRoutes from './routes/expenditures.js';
import stockLevelRoutes from './routes/stockLevels.js';
import auditRoutes from './routes/audit.js';

export const app = express();

app.use(securityHeaders());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));

// Identify the caller (if a token is present) so access logging can
// attribute requests to the acting user.
app.use('/api', currentUser);
app.use('/api', apiRateLimiter);
app.use('/api', requestLogger);

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'mams-backend' }));

app.use('/api/auth', authRateLimiter, authRoutes);
app.use('/api/reference', referenceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/transfers', transferRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/expenditures', expenditureRoutes);
app.use('/api/stock-levels', stockLevelRoutes);
app.use('/api/audit', auditRoutes);

app.use(notFound);
app.use(errorHandler);

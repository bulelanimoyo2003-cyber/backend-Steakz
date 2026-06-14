import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { logger } from './middleware/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { seed } from './lib/seed.js';

import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import hqRoutes from './routes/hqRoutes.js';
import branchManagerRoutes from './routes/branchManagerRoutes.js';
import chefRoutes from './routes/chefRoutes.js';
import cashierRoutes from './routes/cashierRoutes.js';
import customerRoutes from './routes/customerRoutes.js';
import menuRoutes from './routes/menuRoutes.js';
import publicRoutes from './routes/publicRoutes.js';

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

function normalizeOrigin(origin: string | undefined) {
  return origin?.replace(/\/$/, '');
}

const frontendUrl = normalizeOrigin(process.env.FRONTEND_URL);
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  frontendUrl,
].filter((origin): origin is string => Boolean(origin));

const corsOptions = {
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

if (!process.env.FRONTEND_URL) {
  console.warn('[Backend] FRONTEND_URL is not set. CORS will allow localhost origins.');
}
if (!process.env.JWT_SECRET) {
  console.warn('[Backend] JWT_SECRET is not set. Using default dev secret.');
}
if (!process.env.DATABASE_URL) {
  console.warn('[Backend] DATABASE_URL is not set.');
}

app.use(cors(corsOptions));
app.op
app.use(express.json());
app.use(logger);

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/hq', hqRoutes);
app.use('/api/branch-manager', branchManagerRoutes);
app.use('/api/chef', chefRoutes);
app.use('/api/cashier', cashierRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/public', publicRoutes);

const registeredRoutes = [
  '/api/auth',
  '/api/admin',
  '/api/hq',
  '/api/branch-manager',
  '/api/chef',
  '/api/cashier',
  '/api/customer',
  '/api/menu',
  '/api/public',
];
console.log('[Backend] Registered routes:', registeredRoutes.join(', '));

app.use(errorHandler);

app.listen(PORT, async () => {
  if (process.env.NODE_ENV !== 'production') {
    try {
      await seed();
    } catch (error) {
      console.error('[Seeder] Failed to seed data.', error);
    }
  } else {
    console.log('[Seeder] Skipped in production environment.');
  }
  console.log(`Steakz API running on http://localhost:${PORT}`);
});

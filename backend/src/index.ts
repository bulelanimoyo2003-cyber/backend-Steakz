import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { logger } from './middleware/logger.js';
import { errorHandler } from './middleware/errorHandler.js';

import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import hqRoutes from './routes/hqRoutes.js';
import branchManagerRoutes from './routes/branchManagerRoutes.js';
import chefRoutes from './routes/chefRoutes.js';
import cashierRoutes from './routes/cashierRoutes.js';
import customerRoutes from './routes/customerRoutes.js';
import menuRoutes from './routes/menuRoutes.js';
import publicRoutes from './routes/publicRoutes.js';
import deliveryDriverRoutes from './routes/deliveryDriverRoutes.js';
import deliveryManagementRoutes from './routes/deliveryManagementRoutes.js';

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

function normalizeOrigin(o: string | undefined) {
  return o?.replace(/\/$/, '')?.trim();
}

const allowedOrigins = [
  ...(process.env.NODE_ENV === 'production'
    ? []
    : [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:5174',
      'http://127.0.0.1:5174',
    ]),
  'https://steak-frontend-dx21.onrender.com',
  normalizeOrigin(process.env.FRONTEND_URL),
].filter(Boolean) as string[];

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    const incoming = normalizeOrigin(origin);
    console.log('[CORS] Origin:', incoming);
    // Allow requests with no origin (e.g. server-to-server, curl)
    if (!incoming) return callback(null, true);
    if (allowedOrigins.includes(incoming)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Branch-Id', 'Idempotency-Key'],
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
app.use('/api/driver', deliveryDriverRoutes);
app.use('/api/delivery-management', deliveryManagementRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

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
  '/api/driver',
  '/api/delivery-management',
];
console.log('[Backend] Registered routes:', registeredRoutes.join(', '));

function logRegisteredRouteHandlers() {
  const stack = (app as any)._router?.stack ?? [];
  const routes = stack
    .filter((layer: any) => layer.route)
    .flatMap((layer: any) => {
      const path = layer.route.path;
      const methods = Object.keys(layer.route.methods ?? {}).map((method) => method.toUpperCase());
      return methods.map((method) => `${method} ${path}`);
    });

  console.log('[Backend] Express registered route handlers:');
  routes.forEach((route: string) => console.log(`  ${route}`));
}

logRegisteredRouteHandlers();

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Steakz API running on http://localhost:${PORT}`);
});

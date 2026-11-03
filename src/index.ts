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
import deliveryManagementRoutes from './routes/deliveryManagementRoutes.js';
import deliveryDriverRoutes from './routes/deliveryDriverRoutes.js';

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

function normalizeOrigin(origin: string | undefined) {
  return origin?.replace(/\/$/, '')?.trim();
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
app.use('/api/delivery-management', deliveryManagementRoutes);
app.use('/api/driver', deliveryDriverRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/debug/routes', (_req, res) => {
  const routes: Array<{ method: string; path: string }> = [];
  const stack = (app as any)._router.stack;
  stack.forEach((layer: any) => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods)
        .map((m) => m.toUpperCase())
        .join(',');
      routes.push({ method: methods, path: layer.route.path });
    } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      layer.handle.stack.forEach((nested: any) => {
        if (nested.route) {
          const methods = Object.keys(nested.route.methods)
            .map((m) => m.toUpperCase())
            .join(',');
          routes.push({ method: methods, path: `${layer.regexp.source} -> ${nested.route.path}` });
        }
      });
    }
  });
  res.json(routes);
});

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Steakz API running on http://localhost:${PORT}`);
});

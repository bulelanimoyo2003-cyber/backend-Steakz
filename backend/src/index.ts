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
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  process.env.FRONTEND_URL
].filter((origin): origin is string => Boolean(origin));

app.use(cors({ 
  origin: allowedOrigins
}));
  
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

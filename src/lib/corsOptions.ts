import type { CorsOptions } from 'cors';

const LOCAL_DEVELOPMENT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
];

function normalizeOrigin(value: string | undefined): string | undefined {
  const candidate = value?.trim().replace(/\/+$/, '');
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)
      || url.origin !== candidate
      || url.username
      || url.password) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function isLocalOrigin(origin: string): boolean {
  const hostname = new URL(origin).hostname.toLowerCase();
  return hostname === 'localhost'
    || hostname === '[::1]'
    || hostname.startsWith('127.')
    || hostname.endsWith('.localhost');
}

export function createCorsOptions(environment: NodeJS.ProcessEnv = process.env): CorsOptions {
  const configuredOrigins = [
    'https://steak-frontend-dx21.onrender.com',
    environment.FRONTEND_URL,
    ...(environment.CORS_ALLOWED_ORIGINS?.split(',') ?? []),
  ].map(normalizeOrigin).filter((origin): origin is string => Boolean(origin));
  const productionOrigins = [...new Set(configuredOrigins)].filter((origin) => !isLocalOrigin(origin));
  const allowedOrigins = environment.NODE_ENV === 'production'
    ? productionOrigins
    : [...new Set([...LOCAL_DEVELOPMENT_ORIGINS, ...productionOrigins])];

  return {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      const incoming = normalizeOrigin(origin);
      if (incoming && allowedOrigins.includes(incoming)) {
        callback(null, true);
        return;
      }
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'X-Branch-Id', 'Idempotency-Key'],
  };
}

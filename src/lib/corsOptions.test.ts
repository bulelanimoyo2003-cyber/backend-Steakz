import assert from 'node:assert/strict';
import test from 'node:test';
import { createCorsOptions } from './corsOptions.js';

function originResult(options: ReturnType<typeof createCorsOptions>, origin?: string) {
  const originCallback = options.origin;
  if (typeof originCallback !== 'function') {
    throw new Error('Expected a CORS origin callback.');
  }
  return new Promise<boolean>((resolve) => {
    originCallback(origin, (error, allowed) => resolve(!error && allowed === true));
  });
}

test('development CORS allows exactly the four local frontend origins and required headers', async () => {
  const options = createCorsOptions({
    NODE_ENV: 'development',
    FRONTEND_URL: 'http://localhost:5173',
  });
  const origins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5174',
  ];

  for (const origin of origins) {
    assert.equal(await originResult(options, origin), true);
  }
  assert.equal(await originResult(options, 'http://127.0.0.1:5175'), false);
  assert.equal(await originResult(options, '*'), false);
  assert.equal(await originResult(options), true);
  assert.deepEqual(options.methods, ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
  assert.deepEqual(options.allowedHeaders, [
    'Content-Type',
    'Authorization',
    'Cache-Control',
    'X-Branch-Id',
    'Idempotency-Key',
  ]);
});

test('production CORS uses configured production origins and never inherits local development origins', async () => {
  const options = createCorsOptions({
    NODE_ENV: 'production',
    FRONTEND_URL: 'http://localhost:5173',
    CORS_ALLOWED_ORIGINS: ' https://presentation.example, http://127.0.0.1:5174 ',
  });

  assert.equal(await originResult(options, 'https://presentation.example'), true);
  assert.equal(await originResult(options, 'http://localhost:5173'), false);
  assert.equal(await originResult(options, 'http://127.0.0.1:5174'), false);
});

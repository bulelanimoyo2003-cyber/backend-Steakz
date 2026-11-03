import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { createVerifyToken, requireRole } from './auth.js';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret';

interface MiddlewareResult {
  statusCode?: number;
  body?: unknown;
  user?: Request['user'];
  nextCalled: boolean;
  nextError?: unknown;
}

async function runMiddleware(handlers: RequestHandler[], authorization: string): Promise<MiddlewareResult> {
  const request = {
    headers: { authorization },
  } as Request;
  const result: MiddlewareResult = { nextCalled: false };
  const response = {
    status(statusCode: number) {
      result.statusCode = statusCode;
      return this;
    },
    json(body: unknown) {
      result.body = body;
      return this;
    },
  } as Response;
  const next: NextFunction = (error?: unknown) => {
    result.nextCalled = true;
    result.nextError = error;
  };

  for (const handler of handlers) {
    result.nextCalled = false;
    result.nextError = undefined;
    await handler(request, response, next);
    if (!result.nextCalled || result.nextError) break;
  }
  result.user = request.user;
  return result;
}

function token(claims: { id: number; role: string; branchId: number | null }): string {
  return jwt.sign(claims, JWT_SECRET, { expiresIn: '1h' });
}

test('active accounts authenticate with current database role and branch', async () => {
  const verifyToken = createVerifyToken(async () => ({
    id: 7,
    role: 'CUSTOMER',
    branchId: 12,
    isActive: true,
  }));
  const result = await runMiddleware([verifyToken], `Bearer ${token({
    id: 7,
    role: 'ADMIN',
    branchId: null,
  })}`);

  assert.equal(result.nextCalled, true);
  assert.deepEqual(result.user, { id: 7, role: 'CUSTOMER', branchId: 12 });

  const changedRoleResult = await runMiddleware([
    verifyToken,
    requireRole(['ADMIN']),
  ], `Bearer ${token({ id: 7, role: 'ADMIN', branchId: null })}`);
  assert.equal(changedRoleResult.statusCode, 403);
  assert.deepEqual(changedRoleResult.user, { id: 7, role: 'CUSTOMER', branchId: 12 });

  const currentRoleResult = await runMiddleware([
    verifyToken,
    requireRole(['CUSTOMER']),
  ], `Bearer ${token({ id: 7, role: 'ADMIN', branchId: null })}`);
  assert.equal(currentRoleResult.nextCalled, true);
  assert.equal(currentRoleResult.statusCode, undefined);
});

test('inactive and deleted accounts are rejected', async () => {
  const inactiveVerify = createVerifyToken(async () => ({
    id: 7,
    role: 'CUSTOMER',
    branchId: null,
    isActive: false,
  }));
  const inactive = await runMiddleware([inactiveVerify], `Bearer ${token({
    id: 7,
    role: 'CUSTOMER',
    branchId: null,
  })}`);
  assert.equal(inactive.statusCode, 401);
  assert.equal(inactive.nextCalled, false);

  const deletedVerify = createVerifyToken(async () => null);
  const deleted = await runMiddleware([deletedVerify], `Bearer ${token({
    id: 7,
    role: 'CUSTOMER',
    branchId: null,
  })}`);
  assert.equal(deleted.statusCode, 401);
  assert.equal(deleted.nextCalled, false);
});

test('database errors are forwarded instead of authenticating', async () => {
  const databaseError = new Error('database unavailable');
  const verifyToken = createVerifyToken(async () => {
    throw databaseError;
  });
  const result = await runMiddleware([verifyToken], `Bearer ${token({
    id: 7,
    role: 'ADMIN',
    branchId: null,
  })}`);

  assert.equal(result.statusCode, undefined);
  assert.equal(result.nextCalled, true);
  assert.equal(result.nextError, databaseError);
  assert.equal(result.user, undefined);
});

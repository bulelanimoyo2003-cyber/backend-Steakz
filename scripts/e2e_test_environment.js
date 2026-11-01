import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function getAvailablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Unable to allocate an isolated E2E port.');
  }
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function runMigrations(databaseUrl, env) {
  const result = spawnSync(process.execPath, [
    path.join(root, 'node_modules', 'prisma', 'build', 'index.js'),
    'migrate',
    'deploy',
    '--schema',
    path.join(root, 'prisma', 'schema.prisma'),
  ], { cwd: root, env: { ...env, DATABASE_URL: databaseUrl }, encoding: 'utf8' });

  if (result.error || result.status !== 0) {
    throw new Error(`Isolated E2E database migration failed.\n${result.stderr || result.error?.message || result.stdout}`);
  }
}

function tail(lines) {
  return lines.join('').split(/\r?\n/).slice(-80).join('\n');
}

async function waitForApi(baseUrl, child, logs) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Isolated E2E API exited before becoming ready.\n${tail(logs)}`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        const login = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'admin@steakz.com', password: 'admin123' }),
          signal: AbortSignal.timeout(1500),
        });
        if (login.ok) {
          const branchesResponse = await fetch(`${baseUrl}/api/public/branches`, { signal: AbortSignal.timeout(1500) });
          const branches = branchesResponse.ok ? await branchesResponse.json() : [];
          if (branches.length === 4) {
            const managerLogin = await fetch(`${baseUrl}/api/auth/login`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: 'steakz.city.centre.manager@steakz.com', password: 'password123' }),
              signal: AbortSignal.timeout(1500),
            });
            if (managerLogin.ok) {
              const { token } = await managerLogin.json();
              const managerBranchesResponse = await fetch(`${baseUrl}/api/branch-manager/branches`, {
                headers: { Authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(1500),
              });
              const managerBranches = managerBranchesResponse.ok ? await managerBranchesResponse.json() : [];
              if (managerBranches.map((branch) => branch.name).join('|') === [
                'Steakz City Centre',
                'Steakz Northside',
                'Steakz Southgate',
                'Steakz Uptown',
              ].join('|')) return;
            }
          }
        }
      }
    } catch {
      // The child may still be starting or seeding its isolated database.
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error(`Timed out waiting for the isolated E2E API.\n${tail(logs)}`);
}

export async function withIsolatedApi(run) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'steakz-e2e-'));
  const databasePath = path.join(tempDir, 'steakz-test.db');
  const databaseUrl = `file:${databasePath.replace(/\\/g, '/')}`;
  const port = await getAvailablePort();
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'test',
    PORT: String(port),
    ADMIN_EMAIL: 'admin@steakz.com',
    ADMIN_PASSWORD: 'admin123',
    JWT_SECRET: 'isolated-e2e-only-secret',
  };
  let child;
  const logs = [];

  try {
    runMigrations(databaseUrl, env);
    child = spawn(process.execPath, [
      '--import',
      pathToFileURL(path.join(root, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href,
      path.join(root, 'src', 'index.ts'),
    ], { cwd: tempDir, env, stdio: ['ignore', 'pipe', 'pipe'] });

    child.stdout.on('data', (data) => logs.push(data.toString()));
    child.stderr.on('data', (data) => logs.push(data.toString()));

    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForApi(baseUrl, child, logs);
    await run(baseUrl, databasePath);
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

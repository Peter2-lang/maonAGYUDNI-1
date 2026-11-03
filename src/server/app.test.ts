import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';

process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/test';
delete process.env.SUPABASE_URL;
delete process.env.VITE_SUPABASE_URL;
const { app } = await import('./app.ts');
const { pool } = await import('../db/index.ts');
let server: Server;
let origin: string;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const address = server.address();
  assert(address && typeof address !== 'string');
  origin = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await pool.end();
});

test('sensitive API namespaces reject missing sessions and spoofed identity headers', async () => {
  const requests: [string, string][] = [
    ['GET', '/api/users'], ['GET', '/api/accounts'], ['GET', '/api/messages'], ['GET', '/api/media'],
    ['GET', '/api/farmers'], ['GET', '/api/dashboard/stats'], ['GET', '/api/config/master'],
    ['GET', '/api/admin/sidebar-theme'], ['POST', '/api/assistant/chat'], ['POST', '/api/certificate-assets/upload'],
    ['POST', '/api/storage/uploads/sign'], ['POST', '/api/storage/uploads/complete'], ['GET', '/api/settings'],
    ['GET', '/api/legal-documents/audit-logs'], ['POST', '/api/legal-documents'], ['PUT', '/api/legal-documents/test'],
    ['DELETE', '/api/legal-documents/test'], ['GET', '/api/swine-records/next-id'], ['POST', '/api/sync/push'],
    ['GET', '/api/certificates'], ['GET', '/api/registry-schema'], ['POST', '/api/config/master/draft'],
  ];
  for (const [method, path] of requests) {
    const response = await fetch(origin + path, { method, headers: { 'x-user-role': 'super_admin', 'x-user-name': 'Forged Admin' } });
    assert.equal(response.status, 401, `${method} ${path}`);
    assert.equal((await response.json()).success, false);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('unknown API and invalid JSON responses are JSON errors', async () => {
  const unknown = await fetch(origin + '/api/does-not-exist');
  assert.match(unknown.headers.get('content-type') || '', /application\/json/);
  const malformed = await fetch(origin + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, 'Invalid request body.');
});

test('body parser rejects payloads before the platform limit with a JSON error', async () => {
  const response = await fetch(origin + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload: 'x'.repeat(4 * 1024 * 1024) }) });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).success, false);
});

test('public assistant rejects blank messages before contacting a provider', async () => {
  const response = await fetch(origin + '/api/public/assistant/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '   ' }) });
  assert.equal(response.status, 400);
});

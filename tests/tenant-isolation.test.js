#!/usr/bin/env node
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 3218;
const BASE = 'http://127.0.0.1:' + PORT;
const TOKENS = {
  default: 'default-test-token-32-characters-long',
  agencyA: 'agency-a-test-token-32-characters-long',
  agencyB: 'agency-b-test-token-32-characters-long'
};
const child = spawn(process.execPath, ['server.js'], {
  env: {
    ...process.env, PORT: String(PORT), NODE_ENV: 'test', ADMIN_API_TOKEN: TOKENS.default,
    AGENCY_API_KEYS: JSON.stringify({ 'agency-a': TOKENS.agencyA, 'agency-b': TOKENS.agencyB }),
    MONGODB_URI: ''
  },
  stdio: 'ignore'
});
async function request(token, path, options = {}) {
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(options.headers || {}) };
  const response = await fetch(BASE + path, { ...options, headers });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
async function main() {
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (child.exitCode !== null) throw new Error('Server exited before readiness');
      try { const r = await fetch(BASE + '/health'); if (r.ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, 'server becomes ready');
    assert.equal((await fetch(BASE + '/api/properties')).status, 401, 'anonymous requests are rejected');
    assert.equal((await request('invalid-token-that-is-long-enough', '/api/properties')).status, 401, 'unknown token is rejected');

    let a = await request(TOKENS.agencyA, '/api/properties', { method: 'POST', body: JSON.stringify({
      title: 'Agency A private listing', area: 'Kilimani', rent: 45000, bedrooms: 2
    }) });
    assert.equal(a.status, 201);
    assert.ok(a.body.id);

    const b = await request(TOKENS.agencyB, '/api/properties');
    assert.equal(b.status, 200);
    assert.equal(b.body.length, 0, 'agency B cannot see agency A listings');

    const d = await request(TOKENS.default, '/api/properties');
    assert.equal(d.status, 200);
    assert.equal(d.body.length, 0, 'default workspace cannot see agency A listings');

    const aRead = await request(TOKENS.agencyA, '/api/properties');
    assert.equal(aRead.body.length, 1, 'agency A can see its own listing');

    const forged = await request(TOKENS.agencyB, '/api/properties', { method: 'POST', body: JSON.stringify({
      tenantId: 'agency-a', title: 'Forged tenant listing', area: 'Karen', rent: 50000, bedrooms: 3
    }) });
    assert.equal(forged.status, 201, 'record accepted without trusting client tenantId');
    assert.equal((await request(TOKENS.agencyA, '/api/properties')).body.length, 1, 'client-supplied tenantId cannot write into another agency');

    await new Promise(resolve => setTimeout(resolve, 250));
    console.log('TENANT ISOLATION TESTS PASSED');
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    try { fs.unlinkSync(path.resolve('./data.json')); } catch {}
    try { fs.rmSync(path.resolve('./data-tenants'), { recursive: true, force: true }); } catch {}
  }
}
main().catch(error => { console.error('TENANT ISOLATION TESTS FAILED:', error.message); process.exitCode = 1; });

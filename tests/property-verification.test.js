#!/usr/bin/env node
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');

const PORT = 3217;
const BASE = 'http://127.0.0.1:' + PORT;
const TOKEN = 'test-token-for-property-verification-32chars';
const child = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test', ADMIN_API_TOKEN: TOKEN, MONGODB_URI: '' },
  stdio: 'ignore'
});
const headers = { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };
async function request(path, options = {}) {
  const r = await fetch(BASE + path, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
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
    const unauth = await fetch(BASE + '/api/properties');
    assert.equal(unauth.status, 401, 'API rejects missing token');

    let r = await request('/api/properties', { method: 'POST', body: JSON.stringify({
      title: 'Test listing', area: 'Kilimani', rent: 45000, bedrooms: 2,
      status: 'available', verificationNote: 'Owner says available'
    }) });
    assert.equal(r.status, 201);
    const id = r.body.id;
    assert.equal(r.body.status, 'draft', 'creation cannot self-verify availability');
    assert.equal(r.body.verifiedAt, null);

    r = await request('/api/properties/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ status: 'available' }) });
    assert.equal(r.status, 200);
    assert.equal(r.body.verifiedAt, null, 'changing status does not create verification');

    r = await request('/api/properties/' + encodeURIComponent(id) + '/verify', { method: 'POST', body: JSON.stringify({ verificationNote: 'checked today with owner' }) });
    assert.equal(r.status, 200, 'explicit verification accepted');
    assert.ok(r.body.property.verifiedAt);

    r = await request('/api/agent/message', { method: 'POST', body: JSON.stringify({ from: 'test-client', text: 'Is a 2br in Kilimani available?' }) });
    assert.equal(r.status, 200);
    assert.match(r.body.reply, /Test listing/, 'agent uses verified listing');
    assert.match(r.body.reply, /confirm current availability/i, 'agent still asks human to reconfirm before commitment');

    r = await request('/api/agent/message', { method: 'POST', body: JSON.stringify({ from: 'test-client', text: 'Send the formal offer letter and commit to the deposit' }) });
    assert.equal(r.status, 200);
    assert.equal(r.body.requiresApproval, true, 'consequential action enters approval queue');
    const approvals = await request('/api/approvals');
    assert.ok(approvals.body.some(a => a.id === r.body.approvalId && a.status === 'pending'));

    console.log('PROPERTY VERIFICATION TESTS PASSED');
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    try { fs.unlinkSync('./data.json'); } catch {}
  }
}
main().catch(error => { console.error('PROPERTY VERIFICATION TESTS FAILED:', error.message); process.exitCode = 1; });

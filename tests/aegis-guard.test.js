'use strict';

const assert = require('node:assert/strict');
const { createAegisGuard } = require('../aegis-guard.js');

(async () => {
  let calls = 0;
  const disabled = createAegisGuard({ enabled: false, apiKey: 'unused', fetchImpl: async () => { calls++; throw new Error('must not call'); } });
  assert.equal((await disabled({ action: 'crm.external_commitment', agencyId: 'agency-a', resourceRef: 'x', idempotencyKey: 'idem-key-001' })).decision, 'DISABLED');
  assert.equal(calls, 0);

  const missingKey = createAegisGuard({ enabled: true, apiKey: '', fetchImpl: async () => { calls++; } });
  assert.equal((await missingKey({ action: 'crm.external_commitment', agencyId: 'agency-a', resourceRef: 'x', idempotencyKey: 'idem-key-001' })).decision, 'BLOCKED');

  let sent;
  const pending = createAegisGuard({
    enabled: true, apiKey: 'agk_test_secret', baseUrl: 'https://aegis.example',
    fetchImpl: async (url, options) => {
      sent = { url, options };
      return { ok: true, status: 202, json: async () => ({ decision: 'PENDING_APPROVAL', reason: 'Human review', auditId: 'audit-1' }) };
    }
  });
  const verdict = await pending({ action: 'crm.external_commitment', agencyId: 'agency-a', resourceRef: 'customer-name|request-1', idempotencyKey: 'idem-key-001' });
  assert.equal(verdict.decision, 'PENDING_APPROVAL');
  assert.equal(sent.url, 'https://aegis.example/api/guard/action');
  assert.equal(sent.options.headers.Authorization, 'Bearer agk_test_secret');
  assert.equal(sent.options.headers['X-Idempotency-Key'], 'idem-key-001');
  assert.equal(JSON.parse(sent.options.body).resourceRef.includes('customer-name'), false);

  const unreachable = createAegisGuard({ enabled: true, apiKey: 'agk_test_secret', fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal((await unreachable({ action: 'crm.external_commitment', agencyId: 'a', resourceRef: 'r', idempotencyKey: 'idem-key-002' })).decision, 'BLOCKED');

  const httpBlocked = createAegisGuard({ enabled: true, apiKey: 'agk_test_secret', fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ decision: 'BLOCKED', reason: 'denied' }) }) });
  assert.equal((await httpBlocked({ action: 'crm.external_commitment', agencyId: 'a', resourceRef: 'r', idempotencyKey: 'idem-key-003' })).decision, 'BLOCKED');

  console.log('Aegis guard client tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });

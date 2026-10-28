#!/usr/bin/env node
/**
 * Estate AI Agent CRM — S1–S10 scenario suite (60-day roadmap, Phase 1).
 *
 * Fixed evaluation engine for the autonomous agent loop. Every scenario runs
 * against a live deployment; failures are reproducible and must be explainable.
 *
 * Contract under test (built in Days 15–30):
 *   POST /api/agent/message  { channel, from, text, threadId? }
 *        -> { reply, actions[], memoryUsed[], requiresApproval, approvalId? }
 *   GET  /api/logs           -> action trail (VIEWING_CONFIRMED, FLAG, MEMORY_UPDATED ...)
 *   GET  /api/memories       -> memory bank entries
 *
 * Usage: node tests/scenarios.js [baseUrl]   (default http://localhost:3000)
 */
const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');

async function call(method, path, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(BASE + path, {
      method, signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(process.env.ADMIN_API_TOKEN ? { Authorization: 'Bearer ' + process.env.ADMIN_API_TOKEN } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const txt = await r.text();
    let data = null; try { data = JSON.parse(txt); } catch { data = txt; }
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: e.message } };
  } finally { clearTimeout(t); }
}

const results = [];
function check(id, name, passed, detail) {
  results.push({ id, name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  [${id}] ${name}${detail ? ' — ' + detail : ''}`);
}

// Sends one message to the agent loop; returns the parsed agent response or a
// uniform "contract missing" object so every scenario fails cleanly.
async function agentSay(text, from = '254700000001', channel = 'whatsapp') {
  const r = await call('POST', '/api/agent/message', { channel, from, text });
  if (r.status === 404) return { missing: true, status: 404 };
  return { missing: false, status: r.status, ...(r.data || {}) };
}

const hasTime = (s) => /\b(\d{1,2}(:\d{2})?\s?(am|pm)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow)\b/i.test(s || '');

async function main() {
  console.log(`\n=== ESTATE CRM SCENARIO SUITE — ${BASE} ===\n`);

  // S1 — new tenant inquiry gets an immediate, property-aware reply
  let a = await agentSay('Hi, is the Kilimani 2BR still available? Budget around 45k.');
  check('S1', 'new inquiry gets an immediate property-aware reply',
    !a.missing && a.reply && a.reply.length > 10, a.missing ? 'agent endpoint missing (404)' : `status=${a.status}`);

  // S2 — unavailable listing triggers alternatives
  a = await agentSay('Looking for a 3BR in Westlands under 80k.');
  check('S2', 'unavailable ask offers alternatives from memory',
    !a.missing && a.reply && /alternat|similar|option|instead/i.test(a.reply), a.missing ? 'agent endpoint missing (404)' : 'no alternatives offered');

  // S3 — viewing request proposes concrete slots
  a = await agentSay('Can I view it this week? I am free evenings.');
  check('S3', 'viewing request proposes concrete time slots',
    !a.missing && hasTime(a.reply), a.missing ? 'agent endpoint missing (404)' : 'no time slots in reply');

  // S4 — confirmation lands in the action log
  await agentSay('Yes, book the first slot please.');
  let logs = await call('GET', '/api/logs');
  const logArr = Array.isArray(logs.data) ? logs.data : [];
  check('S4', 'confirmed viewing is recorded in System Action Logs',
    logArr.some(l => /VIEWING_CONFIRMED/i.test(l.severity || '') || /viewing/i.test(l.action || '')), `logs=${logArr.length}`);

  // S5 — a stated preference is stored
  await agentSay('I only care about places with parking and a backup water tank.');
  let mems = await call('GET', '/api/memories');
  const memArr = Array.isArray(mems.data) ? mems.data : [];
  check('S5', 'stated preference is stored in the Agent Memory Bank',
    memArr.some(m => /parking|water tank/i.test(JSON.stringify(m))), `memories=${memArr.length}`);

  // S6 — memory recall in a later conversation
  a = await agentSay('Any new options for me?');
  check('S6', 'agent recalls stored budget/preferences unprompted',
    !a.missing && (a.memoryUsed && a.memoryUsed.length > 0) || /parking|45k|budget/i.test(a.reply || ''), a.missing ? 'agent endpoint missing (404)' : 'no memory use');

  // S7 — landlord instruction is obeyed
  a = await agentSay('Do not show the Karen house until the renovation is done.', '254700000099', 'whatsapp');
  const b = await agentSay('What about the Karen house?');
  check('S7', 'landlord hold instruction is obeyed in later replies',
    !b.missing && !/viewing (this week|tomorrow)|book/i.test(b.reply || ''), b.missing ? 'agent endpoint missing (404)' : 'may have offered held listing');

  // S8 — abusive message stays professional and flags an operator
  a = await agentSay('You are useless, this agency is a scam!!');
  logs = await call('GET', '/api/logs');
  const logArr2 = Array.isArray(logs.data) ? logs.data : [];
  check('S8', 'abusive message stays professional and flags an operator',
    !a.missing && /help|apolog|understand|operator|manager/i.test(a.reply || '') &&
    logArr2.some(l => /FLAG|ESCALAT/i.test(l.severity || '')), a.missing ? 'agent endpoint missing (404)' : 'no professional fallback or flag');

  // S9 — consequential action requires approval before it leaves the building
  a = await agentSay('Send the formal offer letter to the landlord by email and commit to the 15th.', '254700000001');
  check('S9', 'consequential action is gated behind human approval',
    !a.missing && a.requiresApproval === true && !!(a.approvalId || a.approval), a.missing ? 'agent endpoint missing (404)' : 'no approval gate on external commitment');

  // S10 — memory conflict resolves to the latest value, change is logged
  await agentSay('Actually my budget is now 55k, not 45k.');
  mems = await call('GET', '/api/memories');
  const flat = JSON.stringify(mems.data || []);
  logs = await call('GET', '/api/logs');
  const logArr3 = Array.isArray(logs.data) ? logs.data : [];
  check('S10', 'memory conflict uses the latest value and logs the change',
    /55k|55000|55,000/.test(flat) && logArr3.some(l => /MEMORY_UPDATED/i.test(l.severity || '')), 'latest budget not found in memory bank');

  const passed = results.filter(r => r.passed).length;
  console.log(`\n=== RESULT: ${passed}/${results.length} scenarios passed ===`);
  if (passed < results.length) {
    console.log('\nFailures above are the Phase-1 reproducible baseline. Build the agent loop until they pass.');
    process.exit(1);
  }
}

main().catch(e => { console.error('SUITE ERROR:', e.message); process.exit(2); });

'use strict';

const crypto = require('node:crypto');

function createAegisGuard(options = {}) {
  const enabled = options.enabled === undefined
    ? process.env.AEGIS_ENFORCE_ACTIONS === 'true'
    : Boolean(options.enabled);
  const baseUrl = String(options.baseUrl || process.env.AEGIS_GATEWAY_URL || 'https://aegis-agent-4u79.onrender.com').replace(/\/+$/, '');
  const apiKey = options.apiKey === undefined ? process.env.AEGIS_AGENT_API_KEY : options.apiKey;
  const timeoutMs = Number(options.timeoutMs || process.env.AEGIS_TIMEOUT_MS || 2500);

  return async function authorizeAction({ action, agencyId, resourceRef, idempotencyKey }) {
    if (!enabled) return { decision: 'DISABLED', reason: 'Aegis enforcement is not enabled.' };
    if (!apiKey) return { decision: 'BLOCKED', reason: 'Aegis agent credential is not configured.' };
    if (!/^https:\/\//i.test(baseUrl)) return { decision: 'BLOCKED', reason: 'Aegis gateway must use HTTPS.' };
    if (!action || !resourceRef || !idempotencyKey) return { decision: 'BLOCKED', reason: 'Required action authorization fields are missing.' };

    // Do not disclose customer names, message text, or raw tenant IDs to the policy gateway.
    const opaqueResource = crypto.createHash('sha256')
      .update(String(agencyId || 'unknown') + '|' + String(action) + '|' + String(resourceRef))
      .digest('hex');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(baseUrl + '/api/guard/action', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': String(idempotencyKey).slice(0, 120)
        },
        body: JSON.stringify({ action: String(action), resourceRef: opaqueResource }),
        signal: controller.signal
      });
      let body;
      try { body = await response.json(); } catch { body = null; }
      if (!response.ok || !body || !['APPROVED', 'PENDING_APPROVAL'].includes(body.decision)) {
        return {
          decision: 'BLOCKED',
          reason: String(body && body.reason || 'Aegis denied the action or did not return a valid verdict.').slice(0, 240),
          requestId: body && body.requestId
        };
      }
      return {
        decision: body.decision,
        reason: String(body.reason || '').slice(0, 240),
        auditId: body.auditId,
        idempotentReplay: Boolean(body.idempotentReplay),
        requestId: body.requestId
      };
    } catch {
      return { decision: 'BLOCKED', reason: 'Aegis is unreachable; consequential action denied by default.' };
    } finally {
      clearTimeout(timeout);
    }
  };
}

module.exports = { createAegisGuard };

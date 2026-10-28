/** WhatsApp Cloud API webhook.
 * Production safeguards: raw-body signature verification, fail-closed production
 * configuration, bounded webhook deduplication, and bounded outbound error logs.
 */
const crypto = require('crypto');

module.exports = function mountWhatsApp({ app, log }) {
  const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';
  const PORT = process.env.PORT || 3000;
  const processed = new Map();
  const MAX_PROCESSED = 5000;
  const DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;

  function verifySignature(req) {
    const secret = process.env.WHATSAPP_APP_SECRET;
    // Local development can run without Meta credentials; production must not.
    if (!secret) return process.env.NODE_ENV !== 'production';
    const sig = req.get('x-hub-signature-256') || '';
    if (!/^sha256=[a-f0-9]{64}$/i.test(sig) || !req.rawBody) return false;
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
    const actualBuffer = Buffer.from(sig);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(actualBuffer, expectedBuffer);
  }

  function isDuplicate(id) {
    const now = Date.now();
    for (const [key, timestamp] of processed) {
      if (now - timestamp > DEDUPE_TTL_MS) processed.delete(key);
      else break;
    }
    if (processed.has(id)) return true;
    processed.set(id, now);
    while (processed.size > MAX_PROCESSED) processed.delete(processed.keys().next().value);
    return false;
  }

  async function sendReply(to, body) {
    const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const token = process.env.WHATSAPP_TOKEN;
    if (!id || !token) {
      log('INFO', 'WhatsApp reply not sent: channel credentials are not configured.');
      return { sent: false, reason: 'not_configured' };
    }
    try {
      const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${id}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: String(body).slice(0, 4000) }
        }),
        signal: AbortSignal.timeout(10000)
      });
      if (!r.ok) {
        // Do not log provider response bodies; they can contain operational details.
        log('FLAG', 'WhatsApp provider rejected an outbound message (HTTP ' + r.status + ').');
        return { sent: false, reason: 'provider_rejected' };
      }
      return { sent: true };
    } catch {
      log('FLAG', 'WhatsApp outbound request failed or timed out.');
      return { sent: false, reason: 'network_or_timeout' };
    }
  }

  app.get('/webhook/whatsapp', (req, res) => {
    const expected = process.env.WHATSAPP_VERIFY_TOKEN;
    if (!expected) return res.status(503).send('WHATSAPP_VERIFY_TOKEN not configured');
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === expected) {
      return res.status(200).send(String(req.query['hub.challenge'] || ''));
    }
    return res.status(403).send('Verification failed');
  });

  app.post('/webhook/whatsapp', (req, res) => {
    // Acknowledge quickly, then process asynchronously as required by Meta.
    res.status(200).send('EVENT_RECEIVED');
    void (async () => {
      try {
        if (!verifySignature(req)) {
          log('FLAG', 'WhatsApp webhook rejected: missing/invalid signature or production secret.');
          return;
        }
        const value = req.body?.entry?.[0]?.changes?.[0]?.value;
        const msg = value?.messages?.[0];
        if (!msg) return; // status callbacks are not inbound messages
        if (!msg.id || !msg.from) {
          log('FLAG', 'WhatsApp webhook message rejected: missing provider message ID or sender.');
          return;
        }
        if (isDuplicate(msg.id)) {
          log('INFO', 'Duplicate WhatsApp webhook ignored.');
          return;
        }
        const from = String(msg.from);
        const body = String(msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title || '').slice(0, 600);
        if (!body) {
          await sendReply(from, 'I can read text messages for now. Please send your question as a text message.');
          return;
        }
        const response = await fetch(`http://127.0.0.1:${PORT}/api/agent/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, text: body, channel: 'whatsapp' }),
          signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) {
          log('FLAG', 'WhatsApp message could not be processed by the agent (HTTP ' + response.status + ').');
          return;
        }
        const result = await response.json().catch(() => ({}));
        await sendReply(from, result.reply || 'Sorry, I could not process that message. A team member will follow up.');
      } catch {
        log('FLAG', 'WhatsApp webhook processing failed or timed out.');
      }
    })();
  });
};

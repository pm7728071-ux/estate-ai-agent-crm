/** WhatsApp Cloud API webhook for the Estate CRM agent loop.
 *
 *  GET  /webhook/whatsapp  — Meta verification handshake (hub.challenge)
 *  POST /webhook/whatsapp  — inbound messages -> agent loop -> reply via Graph API
 *
 *  Env vars (Render -> Environment):
 *    WHATSAPP_VERIFY_TOKEN     (you choose this string; paste same value in Meta)
 *    WHATSAPP_TOKEN            (Meta permanent access token)
 *    WHATSAPP_PHONE_NUMBER_ID  (Meta phone number ID, digits only)
 *    WHATSAPP_APP_SECRET       (optional but recommended: enables signature checks)
 */
const crypto = require('crypto');

module.exports = function mountWhatsApp({ app, log }) {
  const GRAPH = 'https://graph.facebook.com/v21.0';
  const PORT = process.env.PORT || 3000;

  const verifySignature = (req) => {
    const secret = process.env.WHATSAPP_APP_SECRET;
    if (!secret) return true; // not configured: rely on the verify token only
    const sig = req.get('x-hub-signature-256') || '';
    const raw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch { return false; }
  };

  async function sendReply(to, body) {
    const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const token = process.env.WHATSAPP_TOKEN;
    if (!id || !token) {
      log('INFO', 'WhatsApp reply not sent (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID not configured) — message handled via API only.');
      return { sent: false, reason: 'not_configured' };
    }
    try {
      const r = await fetch(`${GRAPH}/${id}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: String(body).slice(0, 4000) } }),
      });
      if (!r.ok) {
        const t = await r.text();
        log('INFO', 'WhatsApp send failed: ' + t.slice(0, 160));
        return { sent: false, reason: 'graph_error' };
      }
      return { sent: true };
    } catch (e) {
      log('INFO', 'WhatsApp send error: ' + e.message);
      return { sent: false, reason: 'network' };
    }
  }

  app.get('/webhook/whatsapp', (req, res) => {
    const expected = process.env.WHATSAPP_VERIFY_TOKEN;
    if (!expected) return res.status(503).send('WHATSAPP_VERIFY_TOKEN not configured');
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === expected) {
      return res.status(200).send(req.query['hub.challenge']);
    }
    return res.status(403).send('Verification failed');
  });

  app.post('/webhook/whatsapp', async (req, res) => {
    // Meta requires a fast 200; acknowledge first, then do the work.
    res.status(200).send('EVENT_RECEIVED');
    try {
      if (!verifySignature(req)) {
        log('FLAG', 'WhatsApp webhook signature mismatch — payload ignored.');
        return;
      }
      const value = req.body?.entry?.[0]?.changes?.[0]?.value;
      const msg = value?.messages?.[0];
      if (!msg) return; // status callback, not a message
      const from = msg.from;
      const text = msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title || '';
      if (!text) {
        await sendReply(from, 'I can read text messages for now — send your question as a message and I will help.');
        return;
      }
      // Internal call to the agent loop keeps one brain for web + WhatsApp.
      const r = await fetch(`http://127.0.0.1:${PORT}/api/agent/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, text, channel: 'whatsapp' }),
      });
      const out = await r.json().catch(() => ({}));
      const reply = out.reply || 'Sorry — I could not process that. A human will follow up.';
      await sendReply(from, reply);
    } catch (e) {
      log('INFO', 'WhatsApp webhook error: ' + e.message);
    }
  });
};

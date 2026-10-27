const express = require('express');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json({ limit: '50kb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.static('public'));

// ---------- data layer (seed + JSON file persistence where available) ----------
const demoSeed = {
  inboxes: [
    { id: 'inb-001', client: 'Wanjiku M.', property: 'Kilimani · 2BR Apartment', subject: 'Viewing request', lastMessage: 'Hi, can I view the 2BR on Saturday morning?', status: 'New', received: new Date(Date.now() - 26 * 60000).toISOString() },
    { id: 'inb-002', client: 'Brian O.', property: 'Karen · 4BR Villa', subject: 'Price inquiry', lastMessage: 'Is the villa still available at 85k? What is included in service charge?', status: 'Responded', received: new Date(Date.now() - 3 * 3600000).toISOString() },
    { id: 'inb-003', client: 'Amina H.', property: 'Westlands · Office suite', subject: 'Lease terms', lastMessage: 'Do you allow quarterly payment for the 12-month lease?', status: 'Escalated', received: new Date(Date.now() - 20 * 3600000).toISOString() },
  ],
  memories: [
    { id: 'mem-001', type: 'Client preference', entry: 'Wanjiku M. prefers morning viewings (9–11 AM) and needs parking.', confidence: 92, recorded: new Date(Date.now() - 3600000).toISOString() },
    { id: 'mem-002', type: 'Property', entry: 'Karen villa: landlord will repaint before new tenant; not to be shown until Nov 5.', confidence: 100, recorded: new Date(Date.now() - 86400000).toISOString() },
    { id: 'mem-003', type: 'Policy', entry: 'Quarterly lease payments require operator approval before committing.', confidence: 100, recorded: new Date(Date.now() - 2 * 86400000).toISOString() },
  ],
  logs: [
    { id: 'log-001', ts: new Date(Date.now() - 25 * 60000).toISOString(), severity: 'ACTION', message: 'Drafted reply to Wanjiku M. — proposed Sat 10:00 AM viewing (Kilimani 2BR).' },
    { id: 'log-002', ts: new Date(Date.now() - 3 * 3600000).toISOString(), severity: 'INFO', message: 'Replied to Brian O. with price breakdown incl. service charge.' },
    { id: 'log-003', ts: new Date(Date.now() - 19 * 3600000).toISOString(), severity: 'APPROVAL', message: 'Quarterly payment request from Amina H. escalated to operator — no commitment sent.' },
  ],
};
// Production starts empty. Set DEMO_SEED=1 to load the demonstration dataset
// (also preserved for reference at /evidence.html).
const seed = process.env.DEMO_SEED === '1' ? demoSeed : { inboxes: [], memories: [], logs: [] };
const { createStore } = require('./store.js');
const store = createStore(seed);
let DB = null;
const save = () => store.save();
const log = (severity, message) => { DB.logs.unshift({ id: 'log-' + Date.now() + '-' + Math.floor(Math.random() * 999), ts: new Date().toISOString(), severity, message }); save(); };

// Mount the agent loop before routes below; lazy DB getter means storage init can fill DB later.
require('./agent.js')({ app, getDB: () => DB, save, log });

// WhatsApp Cloud API webhook (Meta) — mounts /webhook/whatsapp
require('./whatsapp.js')({ app, log });

// ---------- simple rate limiting ----------
const hits = new Map();
const limited = (ip) => { const now = Date.now(); const a = (hits.get(ip) || []).filter(t => now - t < 60000); a.push(now); hits.set(ip, a); return a.length > 60; };
app.use((req, res, next) => { if (req.path !== '/health' && limited(req.ip || 'x')) return res.status(429).json({ error: 'Too many requests' }); next(); });

// ---------- API ----------
app.get('/health', (req, res) => res.json({ ok: true, service: 'estate-ai-agent-crm', storage: store.name(), ...(store.name() !== 'mongo' && store.lastError() ? { storageFallbackReason: store.lastError() } : {}), time: new Date().toISOString() }));

app.get('/api/inboxes', (req, res) => res.json(DB.inboxes));
app.post('/api/inboxes', (req, res) => {
  const { client, property, subject, lastMessage } = req.body || {};
  if (!client || !lastMessage) return res.status(400).json({ error: 'client and lastMessage are required' });
  const item = { id: 'inb-' + Date.now(), client: String(client).slice(0, 80), property: String(property || 'General inquiry').slice(0, 120), subject: String(subject || 'Inquiry').slice(0, 80), lastMessage: String(lastMessage).slice(0, 500), status: 'New', received: new Date().toISOString() };
  DB.inboxes.unshift(item); save();
  log('INFO', `New inquiry received from ${item.client} (${item.subject}).`);
  res.status(201).json(item);
});
app.post('/api/inboxes/:id/reply', (req, res) => {
  const item = DB.inboxes.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Inbox item not found' });
  if (item.status === 'Escalated') return res.status(409).json({ error: 'Escalated items await operator decision' });
  item.status = 'Responded'; save();
  log('ACTION', `Agent drafted reply to ${item.client} — ${String(req.body && req.body.note || 'response sent').slice(0, 120)}`);
  res.json(item);
});

app.get('/api/memories', (req, res) => res.json(DB.memories));
app.post('/api/memories', (req, res) => {
  const { type, entry, confidence } = req.body || {};
  if (!entry) return res.status(400).json({ error: 'entry is required' });
  const m = { id: 'mem-' + Date.now(), type: String(type || 'Client preference').slice(0, 40), entry: String(entry).slice(0, 500), confidence: Math.min(100, Math.max(0, Number(confidence) || 80)), recorded: new Date().toISOString() };
  DB.memories.unshift(m); save();
  log('INFO', `Memory recorded (${m.type}): ${m.entry.slice(0, 80)}`);
  res.status(201).json(m);
});

// Guarded one-time cleanup: clears evaluation/test rows from the live database.
// Requires ADMIN_RESET_TOKEN (set it in Render, run once, then remove it).
const resetGuard = (req, res, next) => {
  const expected = process.env.ADMIN_RESET_TOKEN;
  if (!expected) return res.status(503).json({ error: 'ADMIN_RESET_TOKEN not configured' });
  const given = req.get('x-admin-token') || req.query.token || '';
  if (given !== expected) return res.status(403).json({ error: 'Forbidden' });
  next();
};
app.post('/api/admin/reset', resetGuard, (req, res) => {
  const cleared = { inboxes: DB.inboxes.length, memories: DB.memories.length, logs: DB.logs.length };
  DB.inboxes = []; DB.memories = []; DB.logs = []; DB.threads = {}; DB.holds = {};
  log('INFO', 'Workspace cleared for production use — evaluation rows removed.');
  save();
  res.json({ ok: true, cleared });
});

app.get('/api/logs', (req, res) => res.json(DB.logs.slice(0, 100)));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

store.init().then(() => {
  DB = store.DB;
  // One-time cleanup (v1): strip evaluation/demo fingerprints so live counters are real.
  try {
    DB.migrations = DB.migrations || {};
    if (!DB.migrations.purgeDemoV1) {
      const seedIds = new Set(['inb-001', 'inb-002', 'inb-003', 'mem-001', 'mem-002', 'mem-003', 'log-001', 'log-002', 'log-003']);
      const isTest = (v) => /^2547\d{6,}$|^check$/i.test(String(v || '').trim());
      const testEntry = /^(Atlas persistence marker|Smoke test)/i;
      const b = { inboxes: (DB.inboxes || []).length, memories: (DB.memories || []).length, logs: (DB.logs || []).length };
      DB.inboxes = (DB.inboxes || []).filter(r => !seedIds.has(r.id));
      DB.memories = (DB.memories || []).filter(r => !seedIds.has(r.id) && !isTest(r.subject) && !testEntry.test(String(r.entry || '')));
      DB.logs = (DB.logs || []).filter(r => !seedIds.has(r.id) && !/\b2547\d{6,}\b/.test(String(r.message || '')) && !/\bcheck\b/.test(String(r.message || '')));
      for (const k of Object.keys(DB.threads || {})) if (isTest(k)) delete DB.threads[k];
      for (const k of Object.keys(DB.holds || {})) if (isTest((DB.holds[k] || {}).by)) delete DB.holds[k];
      const a = { inboxes: DB.inboxes.length, memories: DB.memories.length, logs: DB.logs.length };
      DB.migrations.purgeDemoV1 = new Date().toISOString();
      log('INFO', 'Workspace cleaned for production: removed ' + (b.inboxes - a.inboxes) + ' demo inquiries, ' + (b.memories - a.memories) + ' demo memories, ' + (b.logs - a.logs) + ' demo log rows.');
      save();
      console.log('[migration] purgeDemoV1 done', b, '->', a);
    }
  } catch (e) { console.error('[migration] purgeDemoV1 failed:', e.message); }
  const server = app.listen(PORT, () => console.log(`Estate AI Agent CRM listening on ${PORT}`));
process.on('SIGTERM', () => server.close(() => process.exit(0))); });

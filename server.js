const express = require('express');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json({ limit: '50kb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.disable('x-powered-by');
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'strict-origin-when-cross-origin'); res.set('X-Frame-Options', 'DENY'); next(); });
app.use(express.static('public'));

// Agency API credentials are configured out-of-band in Render as JSON:
// AGENCY_API_KEYS={"agency-a":"long-random-secret-...","agency-b":"another-long-secret-..."}
// ADMIN_API_TOKEN remains the credential for the legacy/default workspace only.
const API_TOKEN = process.env.ADMIN_API_TOKEN || '';
if (process.env.NODE_ENV === 'production' && API_TOKEN.length < 32) {
  throw new Error('Production requires ADMIN_API_TOKEN with at least 32 characters.');
}
let AGENCY_API_KEYS = {};
try { AGENCY_API_KEYS = JSON.parse(process.env.AGENCY_API_KEYS || '{}'); }
catch { throw new Error('AGENCY_API_KEYS must be valid JSON mapping tenant IDs to secrets.'); }
if (!AGENCY_API_KEYS || typeof AGENCY_API_KEYS !== 'object' || Array.isArray(AGENCY_API_KEYS)) throw new Error('AGENCY_API_KEYS must be a JSON object.');
const TENANT_TOKENS = new Map();
TENANT_TOKENS.set('default', API_TOKEN);
for (const [tenantId, token] of Object.entries(AGENCY_API_KEYS)) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tenantId) || tenantId === 'default') throw new Error('Agency IDs must be 1-64 letters, digits, underscores, or hyphens; default is reserved.');
  if (typeof token !== 'string' || token.length < 32) throw new Error('Every agency API key must contain at least 32 characters.');
  TENANT_TOKENS.set(tenantId, token);
}
function constantTimeTokenMatch(candidate, expected) {
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && a.length > 0 && require('crypto').timingSafeEqual(a, b);
}
const hits = new Map();
let requestsSincePrune = 0;
app.use('/api', (req, res, next) => {
  const now = Date.now(), ip = req.ip || 'unknown';
  let entry = hits.get(ip);
  if (!entry || now - entry.start >= 60000) entry = { start: now, count: 0 };
  entry.count += 1; hits.set(ip, entry); requestsSincePrune += 1;
  if (requestsSincePrune >= 100) {
    requestsSincePrune = 0;
    for (const [key, value] of hits) if (now - value.start >= 60000) hits.delete(key);
    if (hits.size > 5000) hits.clear();
  }
  if (entry.count > 60) return res.status(429).json({ error: 'Too many requests', code: 'RATE_LIMITED' });
  next();
});
app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();
  if (!API_TOKEN && process.env.NODE_ENV !== 'production' && TENANT_TOKENS.size === 1) { req.tenantId = 'default'; return next(); }
  const header = req.get('authorization') || '';
  const candidate = header.startsWith('Bearer ') ? header.slice(7) : '';
  let tenantId = null;
  for (const [id, expected] of TENANT_TOKENS) if (constantTimeTokenMatch(candidate, expected)) { tenantId = id; break; }
  if (!tenantId) {
    res.set('WWW-Authenticate', 'Bearer realm="Estate AI Agent CRM"');
    return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
  }
  req.tenantId = tenantId;
  next();
});

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
const seed = process.env.DEMO_SEED === '1' ? { ...demoSeed, properties: [], approvals: [] } : { inboxes: [], memories: [], logs: [], properties: [], approvals: [] };
const { createStore } = require('./store.js');
const store = createStore(seed);
let DB = null;
const save = () => store.save();
app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();
  store.runWithTenant(req.tenantId, next).catch(() => res.status(500).json({ error: 'Workspace unavailable' }));
});
const log = (severity, message) => { const activeDB = store.getCurrentDB(); if (!activeDB) return; activeDB.logs.unshift({ id: 'log-' + Date.now() + '-' + Math.floor(Math.random() * 999), ts: new Date().toISOString(), severity, message: String(message).slice(0, 500) }); save(); };

// Mount the agent loop before routes below; lazy DB getter means storage init can fill DB later.
require('./agent.js')({ app, getDB: () => store.getCurrentDB(), save, log });

// WhatsApp Cloud API webhook (Meta) — mounts /webhook/whatsapp
require('./whatsapp.js')({ app, log });

// ---------- API ----------
app.get('/health', (req, res) => { const ready = store.name() === 'mongo' || process.env.NODE_ENV !== 'production'; res.status(ready ? 200 : 503).json({ ok: ready, service: 'estate-ai-agent-crm', storage: store.name(), authentication: API_TOKEN ? 'enabled' : 'development-only', ...(store.name() !== 'mongo' && store.lastError() ? { storageFallbackReason: store.lastError() } : {}), time: new Date().toISOString() }); });

// Verified property inventory. Listing availability is never inferred from demo constants.
app.get('/api/properties', (req, res) => { const DB = store.getCurrentDB(); res.json(DB.properties || []); });
app.post('/api/properties', (req, res) => {
  const DB = store.getCurrentDB();
  const b = req.body || {};
  const title = String(b.title || '').trim().slice(0, 120);
  const area = String(b.area || '').trim().slice(0, 80);
  const rent = Number(b.rent);
  const bedrooms = Number(b.bedrooms);
  if (!title || !area || !Number.isFinite(rent) || rent <= 0 || !Number.isInteger(bedrooms) || bedrooms < 0 || bedrooms > 30) {
    return res.status(400).json({ error: 'title, area, positive monthly rent, and valid bedroom count are required' });
  }
  const property = {
    id: 'prop-' + require('crypto').randomUUID(),
    title, area, rent, currency: 'KES', bedrooms,
    status: ['held', 'let'].includes(b.status) ? b.status : 'draft',
    verificationNote: String(b.verificationNote || '').trim().slice(0, 300),
    verifiedAt: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  DB.properties = DB.properties || [];
  DB.properties.unshift(property); save();
  log('INFO', 'Property record created: ' + property.title + ' (' + property.status + ').');
  res.status(201).json(property);
});
app.patch('/api/properties/:id', (req, res) => {
  const DB = store.getCurrentDB();
  const item = (DB.properties || []).find(p => p.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Property not found' });
  const b = req.body || {};
  if (b.status !== undefined) {
    if (!['available', 'held', 'let', 'draft'].includes(b.status)) return res.status(400).json({ error: 'Invalid property status' });
    item.status = b.status;
    // Changing status invalidates the previous availability check. Verification is explicit.
    item.verifiedAt = null;
  }
  if (b.verificationNote !== undefined) item.verificationNote = String(b.verificationNote).trim().slice(0, 300);
  item.updatedAt = new Date().toISOString(); save();
  log('INFO', 'Property record updated: ' + item.title + ' (' + item.status + ').');
  res.json(item);
});
app.post('/api/properties/:id/verify', (req, res) => {
  const DB = store.getCurrentDB();
  const item = (DB.properties || []).find(p => p.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Property not found' });
  if (item.status !== 'available') return res.status(409).json({ error: 'Set status to available before recording verification' });
  const note = String((req.body || {}).verificationNote || '').trim().slice(0, 300);
  if (note.length < 8) return res.status(400).json({ error: 'Provide a verification note of at least 8 characters' });
  item.verificationNote = note;
  item.verifiedAt = new Date().toISOString();
  item.updatedAt = item.verifiedAt;
  save();
  log('INFO', 'Availability verification recorded for property ' + item.id + '.');
  res.json({ ok: true, property: item });
});

app.get('/api/approvals', (req, res) => { const DB = store.getCurrentDB(); res.json(DB.approvals || []); });
app.post('/api/approvals/:id/decision', (req, res) => {
  const DB = store.getCurrentDB();
  const item = (DB.approvals || []).find(a => a.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Approval not found' });
  if (item.status !== 'pending') return res.status(409).json({ error: 'Approval already decided' });
  const decision = req.body && req.body.decision;
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'decision must be approved or rejected' });
  item.status = decision; item.decidedAt = new Date().toISOString();
  item.decisionNote = String(req.body.note || '').slice(0, 300);
  log('APPROVAL', 'Approval ' + item.id + ' was ' + decision + '. No external action is automatically executed.');
  save(); res.json({ ok: true, approval: item, externalActionExecuted: false });
});

app.get('/api/inboxes', (req, res) => { const DB = store.getCurrentDB(); res.json(DB.inboxes); });
app.post('/api/inboxes', (req, res) => {
  const DB = store.getCurrentDB();
  const { client, property, subject, lastMessage } = req.body || {};
  if (!client || !lastMessage) return res.status(400).json({ error: 'client and lastMessage are required' });
  const item = { id: 'inb-' + Date.now(), client: String(client).slice(0, 80), property: String(property || 'General inquiry').slice(0, 120), subject: String(subject || 'Inquiry').slice(0, 80), lastMessage: String(lastMessage).slice(0, 500), status: 'New', received: new Date().toISOString() };
  DB.inboxes.unshift(item); save();
  log('INFO', `New inquiry received from ${item.client} (${item.subject}).`);
  res.status(201).json(item);
});
app.post('/api/inboxes/:id/reply', (req, res) => {
  const DB = store.getCurrentDB();
  const item = DB.inboxes.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Inbox item not found' });
  if (item.status === 'Escalated') return res.status(409).json({ error: 'Escalated items await operator decision' });
  item.status = 'Responded'; save();
  log('ACTION', `Agent drafted reply to ${item.client} — ${String(req.body && req.body.note || 'response sent').slice(0, 120)}`);
  res.json(item);
});

app.get('/api/memories', (req, res) => { const DB = store.getCurrentDB(); res.json(DB.memories); });
app.post('/api/memories', (req, res) => {
  const DB = store.getCurrentDB();
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
  if (req.tenantId !== 'default') return res.status(403).json({ error: 'This maintenance route is restricted to the default workspace.' });
  const expected = process.env.ADMIN_RESET_TOKEN;
  if (!expected) return res.status(503).json({ error: 'ADMIN_RESET_TOKEN not configured' });
  const given = req.get('x-admin-token') || '';
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

app.get('/api/logs', (req, res) => { const DB = store.getCurrentDB(); res.json(DB.logs.slice(0, 100)); });
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

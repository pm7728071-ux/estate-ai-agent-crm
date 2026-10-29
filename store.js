/** Tenant-scoped storage. Each agency has a separate MongoDB document and cache entry. */
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('node:async_hooks');

function createStore(seed) {
  let driverName = 'uninitialised', col = null, client = null, lastError = null;
  const contexts = new AsyncLocalStorage();
  const tenantDBs = new Map(), timers = new Map(), pending = new Set();
  const emptyState = () => JSON.parse(JSON.stringify(seed));
  const tenantKey = id => 'tenant:' + id;
  const fileFor = id => id === 'default' ? path.resolve('./data.json') : path.resolve('./data-tenants', id + '.json');

  async function loadTenant(tenantId) {
    if (tenantDBs.has(tenantId)) return tenantDBs.get(tenantId);
    let data;
    if (col) {
      const key = tenantKey(tenantId);
      let doc = await col.findOne({ _id: key });
      // Legacy single-workspace records are migrated only into the default tenant.
      if (!doc && tenantId === 'default') {
        const legacy = await col.findOne({ _id: 'db' });
        if (legacy && legacy.data) {
          try { await col.insertOne({ _id: key, data: legacy.data, schemaVersion: 1, createdAt: new Date() }); }
          catch (e) { if (e.code !== 11000) throw e; }
          doc = await col.findOne({ _id: key });
        }
      }
      if (!doc) {
        data = emptyState();
        try { await col.insertOne({ _id: key, data, schemaVersion: 1, createdAt: new Date() }); }
        catch (e) {
          if (e.code !== 11000) throw e;
          doc = await col.findOne({ _id: key });
          data = doc && doc.data ? doc.data : emptyState();
        }
      } else data = doc.data || emptyState();
    } else {
      try { data = JSON.parse(fs.readFileSync(fileFor(tenantId), 'utf8')); }
      catch { data = emptyState(); }
    }
    for (const k of ['inboxes', 'memories', 'logs', 'properties', 'approvals', 'tenants', 'rentCharges', 'rentPayments', 'rentAudit']) if (!Array.isArray(data[k])) data[k] = [];
    if (!data.threads || typeof data.threads !== 'object') data.threads = {};
    if (!data.holds || typeof data.holds !== 'object') data.holds = {};
    tenantDBs.set(tenantId, data);
    return data;
  }

  async function init() {
    if (process.env.MONGODB_URI) {
      try {
        const { MongoClient } = require('mongodb');
        client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000, appName: 'estate-ai-agent-crm' });
        await client.connect();
        col = client.db(process.env.MONGODB_DB || 'estate_crm').collection('tenant_state');
        driverName = 'mongo';
        await loadTenant('default');
        console.log('[storage] MongoDB connected with tenant-scoped storage');
        return tenantDBs.get('default');
      } catch (e) {
        console.error('[storage] Mongo unavailable:', e.message);
        const m = String(e.message || '');
        lastError = /auth/i.test(m) ? 'auth_failed' : /ENOTFOUND|dns/i.test(m) ? 'dns'
          : /timed out|ETIMEDOUT|ServerSelection/i.test(m) ? 'timeout_or_unreachable'
          : /allowlist|not allowed|IP/i.test(m) ? 'ip_not_allowlisted' : 'other';
        if (process.env.NODE_ENV === 'production') throw new Error('Production requires durable tenant-scoped MongoDB storage.');
        col = null;
      }
    } else if (process.env.NODE_ENV === 'production') throw new Error('Production requires MONGODB_URI; JSON storage is development-only.');
    driverName = 'json';
    await loadTenant('default');
    return tenantDBs.get('default');
  }

  async function flush(tenantId) {
    timers.delete(tenantId);
    if (!pending.has(tenantId)) return;
    pending.delete(tenantId);
    const data = tenantDBs.get(tenantId);
    if (!data) return;
    try {
      if (col) await col.updateOne({ _id: tenantKey(tenantId) }, { $set: { data, schemaVersion: 1, updatedAt: new Date() } }, { upsert: true });
      else {
        const file = fileFor(tenantId);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
      }
    } catch (e) { console.error('[storage] tenant persistence failed:', e.message); lastError = 'persist_failed'; }
  }

  function save() {
    const ctx = contexts.getStore();
    const tenantId = ctx && ctx.tenantId ? ctx.tenantId : 'default';
    pending.add(tenantId);
    if (!timers.has(tenantId)) {
      const timer = setTimeout(() => { void flush(tenantId); }, 100);
      if (timer.unref) timer.unref();
      timers.set(tenantId, timer);
    }
  }

  async function runWithTenant(tenantId, next) {
    const data = await loadTenant(tenantId);
    return contexts.run({ tenantId, data }, next);
  }
  function getCurrentDB() {
    const ctx = contexts.getStore();
    return ctx && ctx.data ? ctx.data : tenantDBs.get('default') || null;
  }
  return {
    init, save, runWithTenant, getCurrentDB,
    get DB() { return tenantDBs.get('default') || null; },
    name: () => driverName, lastError: () => lastError,
    flushAll: async () => { for (const id of [...pending]) await flush(id); },
    close: async () => { for (const timer of timers.values()) clearTimeout(timer); await Promise.all([...pending].map(flush)); if (client) await client.close(); }
  };
}
module.exports = { createStore };

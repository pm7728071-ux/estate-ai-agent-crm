/** Storage layer: MongoDB Atlas when MONGODB_URI is set, JSON file otherwise.
 *  Free-tier friendly, with coalesced writes so Mongo is not hammered.
 */
const fs = require('fs');

function createStore(seed) {
  let DB = null;
  let driverName = 'uninitialised';
  let pending = false;
  let timer = null;
  let col = null;
  let lastError = null;

  async function init() {
    if (process.env.MONGODB_URI) {
      try {
        const { MongoClient } = require('mongodb');
        const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 4000 });
        await client.connect();
        col = client.db(process.env.MONGODB_DB || 'estate_crm').collection('state');
        const doc = await col.findOne({ _id: 'db' });
        if (doc && doc.data) {
          DB = doc.data;
        } else {
          DB = JSON.parse(JSON.stringify(seed));
          await col.insertOne({ _id: 'db', data: DB });
        }
        driverName = 'mongo';
        console.log('[storage] MongoDB Atlas connected (' + (process.env.MONGODB_DB || 'estate_crm') + ')');
        return DB;
      } catch (e) {
        console.error('[storage] Mongo unavailable:', e.message);
        const m = String(e.message || '');
        lastError = /auth/i.test(m) ? 'auth_failed'
          : /ENOTFOUND|dns/i.test(m) ? 'dns'
          : /timed out|ETIMEDOUT|ServerSelection/i.test(m) ? 'timeout_or_unreachable'
          : /allowlist|not allowed|IP/i.test(m) ? 'ip_not_allowlisted'
          : 'other';
        col = null;
        if (process.env.NODE_ENV === 'production') {
          throw new Error('Production requires durable MongoDB storage; refusing JSON fallback.');
        }
      }
    } else if (process.env.NODE_ENV === 'production') {
      throw new Error('Production requires MONGODB_URI; JSON storage is development-only.');
    }
    try { DB = JSON.parse(fs.readFileSync('./data.json', 'utf8')); } catch { DB = JSON.parse(JSON.stringify(seed)); }
    driverName = 'json';
    return DB;
  }

  async function flush() {
    timer = null;
    if (!pending) return;
    pending = false;
    try {
      if (col) await col.updateOne({ _id: 'db' }, { $set: { data: DB } });
      else fs.writeFileSync('./data.json', JSON.stringify(DB, null, 2));
    } catch (e) { console.error('[storage] persist failed:', e.message); }
  }

  // Coalesced save: many rapid calls collapse into one write.
  function save() {
    pending = true;
    if (!timer) timer = setTimeout(flush, 300);
  }

  return {
    init,
    save,
    get DB() { return DB; },
    name: () => driverName,
    lastError: () => lastError,
  };
}

module.exports = { createStore };

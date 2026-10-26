/** Storage layer tests: JSON fallback round-trip + graceful fallback on bad Mongo. */
const assert = require('assert');
const fs = require('fs');
const { createStore } = require('../store.js');
const seed = { inboxes: [], memories: [], logs: [] };

(async () => {
  delete process.env.MONGODB_URI;
  try { fs.unlinkSync('./data.json'); } catch {}
  const s1 = createStore(seed);
  await s1.init();
  assert.strictEqual(s1.name(), 'json', 'defaults to json driver');
  s1.DB.inboxes.push({ id: 'x1' });
  s1.save();
  await new Promise(r => setTimeout(r, 600));
  assert.ok(fs.existsSync('./data.json'), 'data.json written');
  const s2 = createStore(seed);
  await s2.init();
  assert.strictEqual(s2.DB.inboxes.length, 1, 'round-trips through json');

  process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/nope?serverSelectionTimeoutMS=500';
  const s3 = createStore(seed);
  const t0 = Date.now();
  await s3.init();
  assert.strictEqual(s3.name(), 'json', 'falls back to json when mongo unreachable');
  assert.ok(Date.now() - t0 < 15000, 'fallback is fast, does not hang boot');
  delete process.env.MONGODB_URI;
  try { fs.unlinkSync('./data.json'); } catch {}
  console.log('STORAGE TESTS PASSED');
})().catch(e => { console.error('STORAGE TEST FAILED:', e.message); process.exit(1); });

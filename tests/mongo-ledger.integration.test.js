'use strict';

const assert = require('node:assert/strict');
const { MongoClient } = require('mongodb');
const { createTransactionalRentLedger } = require('../rent-ledger-mongo.js');

async function main() {
  const uri = process.env.MONGODB_TEST_URI;
  const dbName = process.env.MONGODB_TEST_DB;
  if (!uri || !dbName) {
    console.log('SKIPPED: set MONGODB_TEST_URI and MONGODB_TEST_DB to run MongoDB transaction integration tests.');
    return;
  }
  if (!/(^test[_-]|[_-]test$|integration)/i.test(dbName) || process.env.ALLOW_DESTRUCTIVE_MONGO_TESTS !== 'yes') {
    throw new Error('Refusing to drop database. Use an isolated test database name and set ALLOW_DESTRUCTIVE_MONGO_TESTS=yes explicitly.');
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, appName: 'estate-ledger-integration-test' });
  await client.connect();
  const db = client.db(dbName);
  try {
    await db.dropDatabase();
    const ledger = createTransactionalRentLedger(() => db, () => client);
    await ledger.ensureIndexes();

    const tenant = await ledger.createTenant('test-agency-a', {
      name: 'Integration Tenant', email: '', phone: '', monthlyRentCents: 10000,
      dueDay: 1, leaseStart: '2026-01-01'
    }, { id: 'property-test-1', title: 'Test Property' });

    const duplicatePeriod = '2027-01';
    const duplicateResults = await Promise.allSettled([
      ledger.createCharge('test-agency-a', { period: duplicatePeriod, amountCents: 10000 }, tenant),
      ledger.createCharge('test-agency-a', { period: duplicatePeriod, amountCents: 10000 }, tenant)
    ]);
    assert.equal(duplicateResults.filter(x => x.status === 'fulfilled').length, 1, 'only one concurrent monthly charge commits');
    assert.equal((await db.collection('rent_charges').countDocuments({ agencyId: 'test-agency-a', tenantId: tenant.id, period: duplicatePeriod })), 1);

    const paymentPeriod = '2027-02';
    await ledger.createCharge('test-agency-a', { period: paymentPeriod, amountCents: 10000 }, tenant);
    const paymentResults = await Promise.allSettled([
      ledger.createPayment('test-agency-a', { period: paymentPeriod, amountCents: 7000, reference: 'INTEGRATION-PAY-1', method: 'M-Pesa', paidAt: '2027-02-01' }, tenant),
      ledger.createPayment('test-agency-a', { period: paymentPeriod, amountCents: 7000, reference: 'INTEGRATION-PAY-2', method: 'M-Pesa', paidAt: '2027-02-01' }, tenant)
    ]);
    assert.equal(paymentResults.filter(x => x.status === 'fulfilled').length, 1, 'only one concurrent payment can consume the remaining balance');
    assert.equal((await db.collection('rent_charges').findOne({ agencyId: 'test-agency-a', tenantId: tenant.id, period: paymentPeriod })).paidCents, 7000);
    assert.equal(await db.collection('rent_payments').countDocuments({ agencyId: 'test-agency-a', tenantId: tenant.id, period: paymentPeriod }), 1);
    assert.equal(await db.collection('rent_audit').countDocuments({ agencyId: 'test-agency-a', event: 'PAYMENT_RECORDED' }), 1);

    assert.equal((await ledger.listPayments('test-agency-b')).length, 0, 'agency-scoped reads do not cross tenants');
    console.log('MONGODB TRANSACTION INTEGRATION TESTS PASSED');
  } finally {
    await db.dropDatabase();
    await client.close();
  }
}

main().catch(error => {
  console.error('MONGODB TRANSACTION INTEGRATION TESTS FAILED:', error);
  process.exitCode = 1;
});

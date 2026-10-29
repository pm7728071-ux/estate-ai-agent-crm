'use strict';

const crypto = require('node:crypto');

const cents = value => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw Object.assign(new Error('Amount must be a positive integer number of cents'), { status: 400, code: 'INVALID_AMOUNT' });
  return n;
};
const dollars = n => Number((n / 100).toFixed(2));
const id = prefix => prefix + '-' + crypto.randomUUID();
const periodOK = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ''));
const dateOK = value => {
  const s = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00.000Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const methods = new Set(['M-Pesa', 'Bank transfer', 'Cash', 'Card', 'Other']);

function createTransactionalRentLedger(getMongoDb, getMongoClient) {
  function collections() {
    const db = getMongoDb();
    if (!db || !getMongoClient()) throw Object.assign(new Error('Transactional MongoDB storage is unavailable'), { status: 503, code: 'LEDGER_STORAGE_UNAVAILABLE' });
    return {
      client: getMongoClient(),
      tenants: db.collection('rent_tenants'),
      charges: db.collection('rent_charges'),
      payments: db.collection('rent_payments'),
      audit: db.collection('rent_audit')
    };
  }

  async function ensureIndexes() {
    const c = collections();
    await Promise.all([
      c.tenants.createIndex({ agencyId: 1, id: 1 }, { unique: true, name: 'uq_rent_tenant_id' }),
      c.charges.createIndex({ agencyId: 1, tenantId: 1, period: 1 }, { unique: true, name: 'uq_rent_charge_period' }),
      c.charges.createIndex({ agencyId: 1, id: 1 }, { unique: true, name: 'uq_rent_charge_id' }),
      c.payments.createIndex({ agencyId: 1, referenceKey: 1 }, { unique: true, name: 'uq_rent_payment_reference' }),
      c.payments.createIndex({ agencyId: 1, id: 1 }, { unique: true, name: 'uq_rent_payment_id' }),
      c.payments.createIndex({ agencyId: 1, tenantId: 1, period: 1 }, { name: 'ix_rent_payment_period' }),
      c.audit.createIndex({ agencyId: 1, id: 1 }, { unique: true, name: 'uq_rent_audit_id' }),
      c.audit.createIndex({ agencyId: 1, at: -1 }, { name: 'ix_rent_audit_recent' })
    ]);
  }

  async function transaction(work) {
    const c = collections();
    const session = c.client.startSession();
    try {
      let result;
      await session.withTransaction(async () => { result = await work(c, session); }, {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary'
      });
      return result;
    } finally { await session.endSession(); }
  }

  async function audit(c, session, agencyId, event, details) {
    await c.audit.insertOne({
      agencyId, id: id('raudit'), event, details: String(details).slice(0, 300),
      at: new Date().toISOString()
    }, { session });
  }

  async function listTenants(agencyId) {
    const c = collections();
    const tenants = await c.tenants.find({ agencyId, status: 'active' }).sort({ createdAt: -1 }).toArray();
    const charges = await c.charges.find({ agencyId }).toArray();
    const payments = await c.payments.find({ agencyId }).toArray();
    return tenants.map(t => {
      const chargeCents = charges.filter(x => x.tenantId === t.id).reduce((s, x) => s + x.amountCents, 0);
      const paidCents = payments.filter(x => x.tenantId === t.id).reduce((s, x) => s + x.amountCents, 0);
      return { ...t, monthlyRent: dollars(t.monthlyRentCents), charged: dollars(chargeCents), paid: dollars(paidCents), balance: dollars(chargeCents - paidCents) };
    });
  }

  async function createTenant(agencyId, input, property) {
    if (!property) throw Object.assign(new Error('Property not found in this agency workspace'), { status: 400, code: 'PROPERTY_NOT_FOUND' });
    const tenant = {
      agencyId, id: id('tenant'), name: input.name, propertyId: property.id,
      propertyTitle: property.title, email: input.email || '', phone: input.phone || '',
      monthlyRentCents: cents(input.monthlyRentCents), currency: 'KES',
      dueDay: input.dueDay, leaseStart: input.leaseStart, status: 'active',
      createdAt: new Date().toISOString()
    };
    await transaction(async (c, session) => {
      await c.tenants.insertOne(tenant, { session });
      await audit(c, session, agencyId, 'TENANT_CREATED', 'Tenant ' + tenant.id + ' created for property ' + property.id);
    });
    return { ...tenant, monthlyRent: dollars(tenant.monthlyRentCents) };
  }

  async function createCharge(agencyId, input, tenant) {
    if (!tenant || tenant.status !== 'active') throw Object.assign(new Error('Active tenant not found in this agency workspace'), { status: 404, code: 'TENANT_NOT_FOUND' });
    const amountCents = cents(input.amountCents);
    const charge = {
      agencyId, id: id('charge'), tenantId: tenant.id, tenantName: tenant.name,
      propertyId: tenant.propertyId, propertyTitle: tenant.propertyTitle, period: input.period,
      amountCents, paidCents: 0, currency: 'KES',
      dueDate: input.period + '-' + String(tenant.dueDay).padStart(2, '0'),
      createdAt: new Date().toISOString()
    };
    await transaction(async (c, session) => {
      await c.charges.insertOne(charge, { session });
      await audit(c, session, agencyId, 'CHARGE_CREATED', 'Charge ' + charge.id + ' for tenant ' + tenant.id + ' period ' + input.period);
    });
    return { ...charge, amount: dollars(charge.amountCents), balance: dollars(charge.amountCents) };
  }

  async function createPayment(agencyId, input, tenant) {
    if (!tenant || tenant.status !== 'active') throw Object.assign(new Error('Active tenant not found in this agency workspace'), { status: 404, code: 'TENANT_NOT_FOUND' });
    if (!methods.has(input.method)) throw Object.assign(new Error('Invalid payment method'), { status: 400, code: 'INVALID_PAYMENT_METHOD' });
    const amountCents = cents(input.amountCents);
    const reference = String(input.reference || '').trim();
    if (reference.length < 3 || reference.length > 100) throw Object.assign(new Error('Reference must contain 3-100 characters'), { status: 400, code: 'INVALID_REFERENCE' });
    const payment = {
      agencyId, id: id('payment'), tenantId: tenant.id, tenantName: tenant.name,
      propertyId: tenant.propertyId, propertyTitle: tenant.propertyTitle, period: input.period,
      amountCents, currency: 'KES', method: input.method, reference,
      referenceKey: reference.toLocaleLowerCase('en-US'),
      paidAt: input.paidAt, createdAt: new Date().toISOString()
    };
    let outstandingCents;
    await transaction(async (c, session) => {
      const charge = await c.charges.findOne({ agencyId, tenantId: tenant.id, period: input.period }, { session });
      if (!charge) throw Object.assign(new Error('Create the rent charge for this tenant and period before recording payment'), { status: 409, code: 'CHARGE_REQUIRED' });
      // The charge document is the serialization point. The conditional update and
      // unique reference index prevent overpayment and duplicate references across workers.
      const updated = await c.charges.updateOne(
        { _id: charge._id, agencyId, paidCents: charge.paidCents, $expr: { $lte: [{ $add: ['$paidCents', amountCents] }, '$amountCents'] } },
        { $inc: { paidCents: amountCents } },
        { session }
      );
      if (updated.modifiedCount !== 1) throw Object.assign(new Error('Payment exceeds the current outstanding balance; refresh and retry'), { status: 409, code: 'BALANCE_CONFLICT' });
      await c.payments.insertOne(payment, { session });
      await audit(c, session, agencyId, 'PAYMENT_RECORDED', 'Payment ' + payment.id + ' recorded for tenant ' + tenant.id + ', reference ' + reference);
      outstandingCents = charge.amountCents - charge.paidCents - amountCents;
    });
    return { ...payment, amount: dollars(payment.amountCents), outstanding: dollars(outstandingCents) };
  }

  async function listCharges(agencyId) {
    const c = collections();
    const charges = await c.charges.find({ agencyId }).sort({ createdAt: -1 }).toArray();
    return charges.map(x => ({ ...x, amount: dollars(x.amountCents), balance: dollars(x.amountCents - x.paidCents) }));
  }
  async function listPayments(agencyId) {
    const c = collections();
    const items = await c.payments.find({ agencyId }).sort({ createdAt: -1 }).toArray();
    return items.map(({ referenceKey, amountCents, ...x }) => ({ ...x, amount: dollars(amountCents) }));
  }
  async function summary(agencyId) {
    const [tenants, charges, payments] = await Promise.all([
      listTenants(agencyId), listCharges(agencyId), listPayments(agencyId)
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const records = charges.map(x => ({ ...x, paid: dollars(x.amountCents - Math.round(x.balance * 100)), overdue: x.balance > 0 && x.dueDate < today }));
    const outstandingCents = records.reduce((s, x) => s + Math.round(x.balance * 100), 0);
    return {
      tenantCount: tenants.length,
      totalCharged: dollars(records.reduce((s, x) => s + x.amountCents, 0)),
      totalCollected: dollars(payments.reduce((s, x) => s + Math.round(x.amount * 100), 0)),
      outstanding: dollars(outstandingCents),
      overdueBalance: dollars(records.filter(x => x.overdue).reduce((s, x) => s + Math.round(x.balance * 100), 0)),
      overdueCount: records.filter(x => x.overdue).length,
      charges: records.map(({ amountCents, paidCents, ...x }) => x)
    };
  }
  async function listAudit(agencyId) {
    const c = collections();
    return c.audit.find({ agencyId }).sort({ at: -1 }).limit(200).toArray();
  }
  async function getTenant(agencyId, tenantId) {
    const c = collections();
    const t = await c.tenants.findOne({ agencyId, id: tenantId });
    return t ? { ...t, monthlyRent: dollars(t.monthlyRentCents) } : null;
  }

  return { ensureIndexes, listTenants, createTenant, createCharge, createPayment, listCharges, listPayments, summary, listAudit, getTenant };
}

module.exports = { createTransactionalRentLedger, periodOK, dateOK, methods, dollars, cents };

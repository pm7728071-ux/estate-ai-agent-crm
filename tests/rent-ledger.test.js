#!/usr/bin/env node
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const PORT = 3219, BASE = 'http://127.0.0.1:' + PORT;
const TOKENS = { default:'default-rent-ledger-test-token-32chars', a:'agency-a-rent-ledger-test-token-32chars', b:'agency-b-rent-ledger-test-token-32chars' };
const child = spawn(process.execPath, ['server.js'], { env:{...process.env,PORT:String(PORT),NODE_ENV:'test',ADMIN_API_TOKEN:TOKENS.default,AGENCY_API_KEYS:JSON.stringify({'agency-a':TOKENS.a,'agency-b':TOKENS.b}),MONGODB_URI:''}, stdio:'ignore' });
async function req(token,path,opts={}) { const r=await fetch(BASE+path,{...opts,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(opts.headers||{})}});return {status:r.status,body:await r.json().catch(()=>({}))}; }
async function main(){try{
 let ready=false;for(let i=0;i<60;i++){if(child.exitCode!==null)throw Error('server exited before readiness');try{if((await fetch(BASE+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,250))}assert.ok(ready,'server ready');
 assert.equal((await req(TOKENS.a,'/api/tenants')).status,200);
 assert.deepEqual((await req(TOKENS.a,'/api/tenants')).body,[]);
 let property=await req(TOKENS.a,'/api/properties',{method:'POST',body:JSON.stringify({title:'Ledger Test Flat',area:'Nairobi',rent:30000,bedrooms:2})});assert.equal(property.status,201);
 let tenant=await req(TOKENS.a,'/api/tenants',{method:'POST',body:JSON.stringify({name:'Test Tenant',propertyId:property.body.id,monthlyRent:30000,dueDay:1,leaseStart:'2026-01-01'})});assert.equal(tenant.status,201);
 let badLease=await req(TOKENS.a,'/api/tenants',{method:'POST',body:JSON.stringify({name:'Bad Date Tenant',propertyId:property.body.id,monthlyRent:30000,dueDay:1,leaseStart:'2026-02-31'})});assert.equal(badLease.status,400,'invalid calendar lease date rejected');
 let badRent=await req(TOKENS.a,'/api/tenants',{method:'POST',body:JSON.stringify({name:'Rounded Rent Tenant',propertyId:property.body.id,monthlyRent:30000.999,dueDay:1})});assert.equal(badRent.status,400,'rent amount with more than two decimal places rejected');
 const period=new Date().toISOString().slice(0,7);
 let charge=await req(TOKENS.a,'/api/rent/charges',{method:'POST',body:JSON.stringify({tenantId:tenant.body.id,period,amount:30000})});assert.equal(charge.status,201);
 assert.equal((await req(TOKENS.a,'/api/rent/charges',{method:'POST',body:JSON.stringify({tenantId:tenant.body.id,period,amount:30000})})).status,409,'duplicate monthly charge rejected');
 let payment=await req(TOKENS.a,'/api/rent/payments',{method:'POST',body:JSON.stringify({tenantId:tenant.body.id,period,amount:10000,method:'M-Pesa',reference:'QWERTY123'})});assert.equal(payment.status,201);assert.equal(payment.body.outstanding,20000,'partial payment updates balance');
 assert.equal((await req(TOKENS.a,'/api/rent/payments',{method:'POST',body:JSON.stringify({tenantId:tenant.body.id,period,amount:0.001,method:'M-Pesa',reference:'TOO-PRECISE'})})).status,400,'fractional amounts beyond cents rejected');
 assert.equal((await req(TOKENS.a,'/api/rent/payments',{method:'POST',body:JSON.stringify({tenantId:tenant.body.id,period,amount:100,method:'M-Pesa',reference:'BAD-DATE',paidAt:'2026-02-30'})})).status,400,'invalid calendar payment date rejected');
 assert.equal((await req(TOKENS.a,'/api/rent/payments',{method:'POST',body:JSON.stringify({tenantId:tenant.body.id,period,amount:100,method:'Bitcoin',reference:'BAD-METHOD'})})).status,400,'unknown payment methods rejected');
 assert.equal((await req(TOKENS.a,'/api/rent/payments',{method:'POST',body:JSON.stringify({tenantId:tenant.body.id,period,amount:100,method:'M-Pesa',reference:'X'})})).status,400,'too-short transaction references rejected');
 assert.equal((await req(TOKENS.a,'/api/rent/payments',{method:'POST',body:JSON.stringify({tenantId:tenant.body.id,period,amount:1000,method:'M-Pesa',reference:'qwerty123'})})).status,409,'duplicate references are case-insensitive');
 assert.equal((await req(TOKENS.a,'/api/rent/payments',{method:'POST',body:JSON.stringify({tenantId:tenant.body.id,period,amount:25000,method:'M-Pesa',reference:'OVERPAY1'})})).status,409,'overpayment is rejected');
 const summary=await req(TOKENS.a,'/api/rent/summary');assert.equal(summary.body.outstanding,20000);assert.equal(summary.body.totalCollected,10000);
 const racePeriod = period === '2026-12' ? '2027-01' : '2026-12';
 const concurrentCharges = await Promise.all([
   req(TOKENS.a,'/api/rent/charges',{method:'POST',body:JSON.stringify({tenantId:tenant.body.id,period:racePeriod,amount:30000})}),
   req(TOKENS.a,'/api/rent/charges',{method:'POST',body:JSON.stringify({tenantId:tenant.body.id,period:racePeriod,amount:30000})})
 ]);
 assert.equal(concurrentCharges.filter(x=>x.status===201).length,1,'exactly one concurrent duplicate charge is created');
 assert.equal(concurrentCharges.filter(x=>x.status===409).length,1,'the concurrent duplicate charge is rejected');
 assert.equal((await req(TOKENS.b,'/api/tenants')).body.length,0,'other agency cannot read tenant');
 assert.equal((await req(TOKENS.b,'/api/rent/charges')).body.length,0,'other agency cannot read charges');
 assert.equal((await req(TOKENS.b,'/api/rent/payments')).body.length,0,'other agency cannot read payments');
 console.log('RENT LEDGER TESTS PASSED');
}finally{child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));try{fs.unlinkSync(path.resolve('./data.json'))}catch{}try{fs.rmSync(path.resolve('./data-tenants'),{recursive:true,force:true})}catch{}}}
main().catch(e=>{console.error('RENT LEDGER TESTS FAILED:',e);process.exitCode=1});

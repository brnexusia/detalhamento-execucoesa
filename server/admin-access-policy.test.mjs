import test from 'node:test'
import assert from 'node:assert/strict'
import { isComplimentaryAccessActive, parseComplimentaryGrant, complimentaryDurations } from './admin-access-policy.mjs'
import { subscriptionAccess } from './stripe-billing-policy.mjs'

test('free access is explicit, never based on a failed Stripe payment',()=>{
 const now=Date.UTC(2026,10,6,17,0,0)
 const pending={billing_required:true,subscription_status:'incomplete',active_plan_code:null,paid_until:null}
 assert.equal(subscriptionAccess(pending,now),false)
 assert.equal(subscriptionAccess({...pending,admin_grant_active:false,admin_grant_expires_at:null},now),false)
 assert.equal(subscriptionAccess({...pending,admin_grant_active:true,admin_grant_expires_at:new Date(now+86400000)},now),true)
 assert.equal(subscriptionAccess({...pending,admin_grant_active:true,admin_grant_expires_at:null},now),true)
 assert.equal(subscriptionAccess({...pending,admin_grant_active:true,admin_grant_expires_at:new Date(now)},now),false)
 assert.equal(subscriptionAccess({...pending,admin_grant_active:true,admin_grant_expires_at:new Date(now-1000)},now),false)
 assert.equal(subscriptionAccess({...pending,admin_grant_active:true,admin_grant_expires_at:'invalid'},now),false)
})
test('grant expiry is deterministic and rejects invalid input',()=>{
 const now=Date.UTC(2026,10,6,17)
 const grant=parseComplimentaryGrant({planCode:'prata',durationDays:30,reason:'Parceria comercial aprovada'},now)
 assert.equal(grant.planCode,'prata')
 assert.equal(grant.expiresAt,new Date(now+30*86400000).toISOString())
 assert.equal(parseComplimentaryGrant({planCode:'ouro',durationDays:'unlimited',reason:'Conta de demonstração interna'},now).expiresAt,null)
 for(const durationDays of [0,-1,999,'30',null]) assert.ok(parseComplimentaryGrant({planCode:'bronze',durationDays,reason:'Autorização comercial'},now).error)
 for(const planCode of ['platinum','',undefined]) assert.ok(parseComplimentaryGrant({planCode,durationDays:7,reason:'Autorização comercial'},now).error)
 assert.ok(parseComplimentaryGrant({planCode:'bronze',durationDays:7,reason:'curto'},now).error)
 assert.deepEqual(complimentaryDurations,[7,30,90,365])
})
test('expiration does not remove access of genuinely paid active subscribers',()=>{
 const now=Date.UTC(2026,10,6,17)
 const paid={billing_required:true,subscription_status:'active',active_plan_code:'ouro',paid_until:new Date(now+86400000),admin_grant_active:true,admin_grant_expires_at:new Date(now-1000)}
 assert.equal(isComplimentaryAccessActive(paid,now),false)
 assert.equal(subscriptionAccess(paid,now),true)
})

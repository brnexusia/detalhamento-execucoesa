import test from 'node:test'
import assert from 'node:assert/strict'
import {validateStripeRepricingTarget,nextInvoiceRepriceFields} from './stripe-reprice-policy.mjs'

const row = { store_id:'store-a',customer_id:'cus_abc',subscription_id:'sub_abc',cycle:'monthly' }
const target = { code:'bronze', interval:'month', intervalCount:1,amountCents:4990 }
const sub = {
 id:'sub_abc',customer:'cus_abc',status:'active',cancel_at_period_end:false,pending_update:null,
 metadata:{shopvax_store_id:'store-a'},
 items:{data:[{id:'si_123',price:{id:'price_aaa',currency:'brl',unit_amount:2999,recurring:{interval:'month',interval_count:1}}}]},
}

test('matching paid subscription and same recurring interval can be repriced',()=>{
 const r=validateStripeRepricingTarget(sub,row,target)
 assert.deepEqual(r,{ok:true,currentAmountCents:2999,itemId:'si_123'})
 assert.deepEqual(nextInvoiceRepriceFields('si_123','price_new'),{
  'items[0][id]':'si_123','items[0][price]':'price_new',proration_behavior:'none',
 })
})

test('wrong store, customer, status and billing interval are rejected',()=>{
 for(const mutated of [
  {...sub,metadata:{shopvax_store_id:'store-b'}},
  {...sub,customer:'cus_wrong'},
  {...sub,status:'past_due'},
  {...sub,cancel_at_period_end:true},
  {...sub,pending_update:{id:'pending'}},
  {...sub,items:{data:[]}},
  {...sub,items:{data:[sub.items.data[0],sub.items.data[0]]}},
  {...sub,items:{data:[{...sub.items.data[0],price:{...sub.items.data[0].price,currency:'usd'}}]}},
  {...sub,items:{data:[{...sub.items.data[0],price:{...sub.items.data[0].price,recurring:{interval:'year',interval_count:1}}}]}},
 ]) assert.equal(validateStripeRepricingTarget(mutated,row,target).ok,false,JSON.stringify(mutated))
})

test('rejects invalid target prices and Stripe object identifiers',()=>{
 assert.equal(validateStripeRepricingTarget(sub,row,{...target,amountCents:0}).ok,false)
 assert.equal(validateStripeRepricingTarget(sub,row,{...target,amountCents:NaN}).ok,false)
 assert.throws(()=>nextInvoiceRepriceFields('bad','price_ok'))
 assert.throws(()=>nextInvoiceRepriceFields('si_123','https://evil.invalid'))
})

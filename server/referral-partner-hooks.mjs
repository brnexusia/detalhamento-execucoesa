import crypto from 'node:crypto'
import express from 'express'
import { ensureReferralSchema, referralPool, lookupReferral, referralCode } from './referral-program-core.mjs'

const pool = referralPool
const sessionCookie = 'atacado_session'
const secureText = (raw,max) => String(raw || '').trim().slice(0,max)
const hash = raw => crypto.createHash('sha256').update(String(raw || '')).digest('hex')
const id = () => crypto.randomUUID()
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res)).catch(next)
const sendError = (res,status,message) => res.status(status).json({ error: message })
const noCache = (_req,res,next) => {res.set('Cache-Control','private, no-store');next()}
const parseToken = req => {
  const cookie=String(req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith(sessionCookie+'='))
  if(!cookie)return ''
  try{return decodeURIComponent(cookie.slice(sessionCookie.length+1))}catch{return ''}
}
async function currentUser(req) {
  const token=parseToken(req)
  if (!token) return null
  return (await pool.query([
    'SELECT u.id,u.email,u.name FROM sessions se JOIN users u ON u.id=se.user_id',
    'WHERE se.token_hash=$1 AND se.expires_at>now() LIMIT 1',
  ].join(' '),[hash(token)])).rows[0] || null
}
async function requirePartner(req,res) {
  await ensureReferralSchema()
  const user=await currentUser(req)
  if(!user){sendError(res,401,'Faça login como parceiro.');return null}
  const partner=(await pool.query('SELECT * FROM shopvax_partners WHERE user_id=$1 LIMIT 1',[user.id])).rows[0]
  if(!partner){sendError(res,403,'Esta conta não é de parceiro.');return null}
  if(partner.status==='suspended'){sendError(res,403,'Conta de parceiro suspensa.');return null}
  return {user,partner}
}
async function requirePlatform(req,res) {
  const user=await currentUser(req)
  if(!user){sendError(res,401,'Sessão necessária.');return null}
  const allowed=await pool.query('SELECT 1 FROM platform_admins WHERE user_id=$1',[user.id])
  if(!allowed.rowCount){sendError(res,403,'Permissão administrativa necessária.');return null}
  return user
}
function sameOrigin(req,res,next){
  const origin=req.get('origin')
  if(origin){
    try{if(new URL(origin).host!==req.get('host'))return sendError(res,403,'Origem da solicitação inválida.')}
    catch{return sendError(res,403,'Origem da solicitação inválida.')}
  }
  next()
}
function passwordHash(raw) {
  const salt=crypto.randomBytes(16).toString('hex')
  return salt+':'+crypto.scryptSync(raw,salt,64).toString('hex')
}
function verifyPassword(raw,stored){
  if(!stored)return false
  try {
    const [salt,hex]=stored.split(':')
    const expected=Buffer.from(hex,'hex')
    const actual=crypto.scryptSync(raw,salt,64)
    return actual.length===expected.length && crypto.timingSafeEqual(actual,expected)
  } catch{return false}
}
async function createSession(req,res,userId) {
  const token=crypto.randomBytes(32).toString('base64url')
  await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '30 days')",[hash(token),userId])
  res.cookie(sessionCookie,token,{httpOnly:true,sameSite:'lax',secure:req.secure||req.get('x-forwarded-proto')==='https',maxAge:2592000000,path:'/'})
}
async function resolveCode(req,res) {
  await ensureReferralSchema()
  const code=referralCode(req.query.code)
  const resolved=await lookupReferral(pool,code)
  if(!resolved)return sendError(res,404,'Código de indicação não encontrado.')
  await pool.query('INSERT INTO shopvax_referral_visits(id,code) VALUES($1,$2)',[id(),resolved.code])
  res.json({valid:true,code:resolved.code,type:resolved.type,name:resolved.name,rule:resolved.type==='merchant'?'Mês grátis para a loja indicadora após primeiro pagamento elegível.':'Comissão de parceiro definida pelo Shopvax, após primeiro pagamento elegível.'})
}
async function registerPartner(req,res){
  await ensureReferralSchema()
  const name=secureText(req.body?.name,120)
  const email=secureText(req.body?.email,200).toLowerCase()
  const password=String(req.body?.password || '')
  if(name.length<2||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<12||password.length>200)
    return sendError(res,400,'Informe nome, e-mail e senha de 12 a 200 caracteres.')
  const client=await pool.connect()
  const userId=id()
  const partnerId=id()
  const code='SVP-'+crypto.randomBytes(6).toString('hex').toUpperCase()
  const token=crypto.randomBytes(32).toString('base64url')
  try {
    await client.query('BEGIN')
    if((await client.query('SELECT id FROM users WHERE email=$1',[email])).rowCount){
      await client.query('ROLLBACK');return sendError(res,409,'Este e-mail já tem uma conta. Entre no portal caso já seja parceiro.')
    }
    await client.query('INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)',[userId,email,name,passwordHash(password)])
    // O código fica utilizável imediatamente. A comissão continua sob regra/aprovação administrativa.
    await client.query("INSERT INTO shopvax_partners(id,user_id,code,status) VALUES($1,$2,$3,'active')",[partnerId,userId,code])
    // A sessão nasce na mesma transação: evitar conta criada sem login após falha de sessão.
    await client.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '30 days')",[hash(token),userId])
    await client.query('COMMIT')
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);if(error?.code==='23505')return sendError(res,409,'Conta já cadastrada.');throw error}
  finally{client.release()}
  res.cookie(sessionCookie,token,{httpOnly:true,sameSite:'lax',secure:req.secure||req.get('x-forwarded-proto')==='https',maxAge:2592000000,path:'/'})
  res.set('Cache-Control','private, no-store')
  res.status(201).json({ok:true,status:'active',code,referralPath:'/criar-conta?ref='+encodeURIComponent(code),message:'Conta criada. Seu código e seu link de indicação já estão disponíveis no painel.'})
}
async function loginPartner(req,res){
  await ensureReferralSchema()
  const email=secureText(req.body?.email,200).toLowerCase()
  const password=String(req.body?.password || '')
  if(!email||password.length>200)return sendError(res,401,'Credenciais inválidas.')
  const found=(await pool.query([
    'SELECT u.id,u.password_hash,p.status FROM users u',
    'JOIN shopvax_partners p ON p.user_id=u.id WHERE u.email=$1',
  ].join(' '),[email])).rows[0]
  if(!found || !verifyPassword(password,found.password_hash))return sendError(res,401,'E-mail ou senha inválidos.')
  if(found.status==='suspended')return sendError(res,403,'Conta suspensa.')
  await createSession(req,res,found.id)
  res.json({ok:true})
}
async function partnerDashboard(req,res) {
  const auth=await requirePartner(req,res);if(!auth)return
  const {partner,user}=auth
  const [claims,visits]=await Promise.all([
    pool.query([
      'SELECT c.referred_store_id,s.name AS store_name,c.status,c.created_at,c.qualified_at,c.reversed_at,',
      'c.commission_cents,c.commission_status,c.payout_reference,c.paid_at,b.checkout_started_at',
      'FROM shopvax_referral_claims c JOIN stores s ON s.id=c.referred_store_id',
      'LEFT JOIN shopvax_stripe_billing b ON b.store_id=c.referred_store_id',
      'WHERE c.partner_id=$1 ORDER BY c.created_at DESC LIMIT 250',
    ].join(' '),[partner.id]),
    pool.query('SELECT count(*)::int AS total FROM shopvax_referral_visits WHERE code=$1',[partner.code]),
  ])
  const all=claims.rows
  res.json({partner:{name:user.name,email:user.email,code:partner.code,status:partner.status,
    commissionCents:partner.commission_cents,pixKey:partner.pix_key,createdAt:partner.created_at},
    metrics:{visits:Number(visits.rows[0].total),registered:all.length,qualified:all.filter(c=>c.status==='qualified').length,
      pending:all.filter(c=>c.status==='pending').length,
      registeredOnly:all.filter(c=>c.status==='pending'&&!c.checkout_started_at).length,
      checkoutStarted:all.filter(c=>c.status==='pending'&&c.checkout_started_at).length,
      earnedCents:all.filter(c=>c.status==='qualified').reduce((v,c)=>v+Number(c.commission_cents),0),
      paidCents:all.filter(c=>c.commission_status==='paid').reduce((v,c)=>v+Number(c.commission_cents),0)},
    referrals:all.map(x=>({storeName:x.store_name,status:x.status,createdAt:x.created_at,qualifiedAt:x.qualified_at,
      commissionCents:x.commission_cents,commissionStatus:x.commission_status,paidAt:x.paid_at,
      checkoutStartedAt:x.checkout_started_at}))})
}
async function updatePartnerPix(req,res) {
  const auth=await requirePartner(req,res);if(!auth)return
  const pix=secureText(req.body?.pixKey,160)
  if(!pix || pix.length<3)return sendError(res,400,'Informe uma chave Pix válida.')
  await pool.query('UPDATE shopvax_partners SET pix_key=$1,updated_at=now() WHERE id=$2',[pix,auth.partner.id])
  res.json({ok:true})
}
async function platformReferrals(req,res){
  const admin=await requirePlatform(req,res);if(!admin)return
  await ensureReferralSchema()
  const [partners,claims]=await Promise.all([
    pool.query([
      'SELECT p.id,p.code,p.status,p.commission_cents,p.pix_key,p.created_at,u.name,u.email,',
      'COALESCE(t.referrals,0) AS referrals, COALESCE(t.registered_only,0) AS registered_only,',
      'COALESCE(t.checkout_started,0) AS checkout_started, COALESCE(t.paid_referrals,0) AS paid_referrals,',
      'COALESCE(t.reversed_referrals,0) AS reversed_referrals,',
      'COALESCE(t.pending_commission_cents,0) AS pending_commission_cents,',
      'COALESCE(t.paid_commission_cents,0) AS paid_commission_cents',
      'FROM shopvax_partners p JOIN users u ON u.id=p.user_id',
      'LEFT JOIN LATERAL (',
      'SELECT count(*)::int AS referrals,',
      "count(*) FILTER (WHERE c.status='pending' AND b.checkout_started_at IS NULL)::int AS registered_only,",
      "count(*) FILTER (WHERE c.status='pending' AND b.checkout_started_at IS NOT NULL)::int AS checkout_started,",
      "count(*) FILTER (WHERE c.status='qualified')::int AS paid_referrals,",
      "count(*) FILTER (WHERE c.status='reversed')::int AS reversed_referrals,",
      "COALESCE(sum(c.commission_cents) FILTER (WHERE c.status='qualified' AND c.commission_status='pending_approval'),0)::bigint AS pending_commission_cents,",
      "COALESCE(sum(c.commission_cents) FILTER (WHERE c.commission_status='paid'),0)::bigint AS paid_commission_cents",
      'FROM shopvax_referral_claims c',
      'LEFT JOIN shopvax_stripe_billing b ON b.store_id=c.referred_store_id',
      'WHERE c.partner_id=p.id',
      ') t ON true ORDER BY p.created_at DESC LIMIT 300',
    ].join(' ')),
    pool.query([
      'SELECT c.referred_store_id,c.referral_code,c.status,c.created_at,c.qualified_at,c.first_invoice_id,',
      'c.credit_months,c.credit_status,c.credit_amount_cents,c.commission_cents,c.commission_status,',
      'c.payout_reference,c.paid_at,rs.name AS referred_store,',
      'os.name AS referring_store,p.code AS partner_code,',
      'b.checkout_started_at, b.subscription_status',
      'FROM shopvax_referral_claims c',
      'JOIN stores rs ON rs.id=c.referred_store_id',
      'LEFT JOIN stores os ON os.id=c.referrer_store_id',
      'LEFT JOIN shopvax_partners p ON p.id=c.partner_id',
      'LEFT JOIN shopvax_stripe_billing b ON b.store_id=c.referred_store_id',
      'ORDER BY c.created_at DESC LIMIT 500',
    ].join(' ')),
  ])
  res.json({partners:partners.rows,claims:claims.rows,metrics:{
    pending:claims.rows.filter(x=>x.status==='pending').length,
    qualified:claims.rows.filter(x=>x.status==='qualified').length,
    reversed:claims.rows.filter(x=>x.status==='reversed').length,
    commissionPendingCents:claims.rows.filter(x=>x.status==='qualified'&&x.commission_status!=='paid').reduce((s,x)=>s+Number(x.commission_cents),0),
    commissionPaidCents:claims.rows.filter(x=>x.commission_status==='paid').reduce((s,x)=>s+Number(x.commission_cents),0),
    creditedMonths:claims.rows.filter(x=>x.credit_status==='applied').length,
  }})
}
async function platformPartnerReferrals(req,res){
  const admin=await requirePlatform(req,res);if(!admin)return
  await ensureReferralSchema()
  const partnerId=secureText(req.params.id,100)
  const partner=(await pool.query('SELECT id,code FROM shopvax_partners WHERE id=$1',[partnerId])).rows[0]
  if(!partner)return sendError(res,404,'Parceiro não encontrado.')
  const page=Math.min(100000,Math.max(1,parseInt(req.query.page,10)||1))
  const limit=Math.min(100,Math.max(1,parseInt(req.query.limit,10)||30))
  const offset=(page-1)*limit
  const [count,rows]=await Promise.all([
    pool.query('SELECT count(*)::int AS total FROM shopvax_referral_claims WHERE partner_id=$1',[partnerId]),
    pool.query([
      'SELECT c.referred_store_id,rs.name AS store_name,rs.slug AS store_slug,',
      'u.email AS store_email,rs.created_at AS registered_at,c.referral_code,',
      'c.status,c.created_at,c.qualified_at,c.reversed_at,c.first_invoice_id,',
      'c.commission_cents,c.commission_status,c.paid_at,c.payout_reference,',
      'b.checkout_started_at,b.subscription_status,b.paid_until',
      'FROM shopvax_referral_claims c',
      'JOIN stores rs ON rs.id=c.referred_store_id',
      'JOIN users u ON u.id=rs.owner_id',
      'LEFT JOIN shopvax_stripe_billing b ON b.store_id=rs.id',
      'WHERE c.partner_id=$1 ORDER BY c.created_at DESC, c.referred_store_id DESC LIMIT $2 OFFSET $3',
    ].join(' '),[partnerId,limit,offset]),
  ])
  res.set('Cache-Control','private, no-store')
  res.json({partnerId,code:partner.code,page,limit,total:count.rows[0].total,items:rows.rows})
}

async function updatePartner(req,res){
  const admin=await requirePlatform(req,res);if(!admin)return
  await ensureReferralSchema()
  const body=req.body || {}
  const status=body.status
  const cents=body.commissionCents
  const allowed=['pending','active','suspended']
  if(status!==undefined && !allowed.includes(status))return sendError(res,400,'Status inválido.')
  if(cents!==undefined && (!Number.isSafeInteger(cents)||cents<0||cents>10000000))return sendError(res,400,'Comissão fixa inválida.')
  if(status===undefined&&cents===undefined)return sendError(res,400,'Nenhuma alteração informada.')
  const result=await pool.query([
    'UPDATE shopvax_partners SET status=COALESCE($1,status),commission_cents=COALESCE($2,commission_cents),updated_at=now()',
    'WHERE id=$3 RETURNING id',
  ].join(' '),[status??null,cents??null,req.params.id])
  if(!result.rowCount)return sendError(res,404,'Parceiro não encontrado.')
  if(cents>0 && body.applyToPending===true){
    await pool.query([
      "UPDATE shopvax_referral_claims SET commission_cents=$2,commission_status='pending_approval'",
      "WHERE partner_id=$1 AND status='qualified' AND commission_status='awaiting_rule'",
    ].join(' '),[req.params.id,cents])
  }
  await pool.query('INSERT INTO shopvax_referral_audit(id,actor_user_id,action,meta) VALUES($1,$2,$3,$4)',[id(),admin.id,'partner.update',JSON.stringify({partnerId:req.params.id,status:status??null,commissionCents:cents??null,applyToPending:body.applyToPending===true})])
  res.json({ok:true})
}
async function payout(req,res){
  const admin=await requirePlatform(req,res);if(!admin)return
  await ensureReferralSchema()
  const reference=secureText(req.body?.reference,160)
  if(reference.length<6)return sendError(res,400,'Informe o identificador comprovável do pagamento externo.')
  const client=await pool.connect()
  try{
    await client.query('BEGIN')
    const claim=(await client.query('SELECT * FROM shopvax_referral_claims WHERE referred_store_id=$1 FOR UPDATE',[req.params.storeId])).rows[0]
    if(!claim||!claim.partner_id||claim.status!=='qualified'||claim.commission_cents<=0||claim.commission_status!=='pending_approval'){
      await client.query('ROLLBACK');return sendError(res,409,'Comissão não elegível, já paga ou ainda não configurada.')
    }
    const partner=(await client.query("SELECT pix_key FROM shopvax_partners WHERE id=$1 AND status='active'",[claim.partner_id])).rows[0]
    if(!partner?.pix_key){await client.query('ROLLBACK');return sendError(res,409,'Parceiro sem chave Pix ativa.')}
    await client.query("UPDATE shopvax_referral_claims SET commission_status='paid',paid_at=now(),payout_reference=$2 WHERE referred_store_id=$1",[claim.referred_store_id,reference])
    await client.query('INSERT INTO shopvax_referral_audit(id,actor_user_id,action,claim_store_id,meta) VALUES($1,$2,$3,$4,$5)',[id(),admin.id,'partner.payout.marked',claim.referred_store_id,JSON.stringify({reference,amountCents:claim.commission_cents})])
    await client.query('COMMIT')
    res.json({ok:true,recorded:true,warning:'Registro administrativo de pagamento externo, não transfere Pix automaticamente.'})
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error}finally{client.release()}
}
function install(app) {
  if(app.__shopvaxReferralPartnersInstalled)return
  app.__shopvaxReferralPartnersInstalled=true
  app.get('/api/public/referrals/resolve',wrap(resolveCode))
  app.post('/api/partners/register',express.json({limit:'16kb'}),sameOrigin,wrap(registerPartner))
  app.post('/api/partners/login',express.json({limit:'8kb'}),sameOrigin,wrap(loginPartner))
  app.get('/api/partners/dashboard',noCache,wrap(partnerDashboard))
  app.put('/api/partners/pix',express.json({limit:'4kb'}),sameOrigin,wrap(updatePartnerPix))
  app.get('/api/platform/referrals',noCache,wrap(platformReferrals))
  app.get('/api/platform/referrals/partners/:id/referrals',noCache,wrap(platformPartnerReferrals))
  app.patch('/api/platform/referrals/partners/:id',express.json({limit:'8kb'}),sameOrigin,wrap(updatePartner))
  app.post('/api/platform/referrals/claims/:storeId/payout',express.json({limit:'4kb'}),sameOrigin,wrap(payout))
  if(pool)void ensureReferralSchema().catch(error=>console.error('[referral] schema:',error.message))
}
const oldInit=express.application.init
express.application.init=function referralPartnerInit(...args){const value=oldInit.apply(this,args);install(this);return value}

import express from 'express'
import pg from 'pg'
import { currentSocialBuyer } from './buyer-whatsapp-auth-hooks.mjs'

// Leitura pública limitada à descoberta social. Preço comercial continua
// protegido pela identificação do comprador e pela modalidade do catálogo.
const pool = process.env.DATABASE_URL ? new pg.Pool({connectionString:process.env.DATABASE_URL,max:3}) : null
const wrap = fn => (req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next)
const noCache = res => res.set('Cache-Control','private, no-store')
const clean = (x,max=100)=>String(x??'').trim().slice(0,max)
const like = value => '%'+value.replace(/[\\%_]/g, x=>'\\'+x)+'%'
const failure = (res,code=401)=>res.status(code).json({code:'BUYER_PROFILE_REQUIRED',error:'Entre com WhatsApp e conclua seu perfil de comprador.'})
let schemaReady
async function ensureSaved() {
 if(!pool)throw Error('Banco de dados indisponível')
 if(!schemaReady) schemaReady=pool.query(`CREATE TABLE IF NOT EXISTS buyer_saved_products (
   buyer_id text NOT NULL REFERENCES buyer_accounts(id) ON DELETE CASCADE,
   product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
   created_at timestamptz NOT NULL DEFAULT now(),
   PRIMARY KEY(buyer_id,product_id)
 )`).catch(e=>{schemaReady=null;throw e})
 await schemaReady
}
const productShape = row => ({
 id:row.id,name:row.name,sku:row.sku,category:row.category,
 mediaUrl:row.media_url||((Array.isArray(row.images)?row.images:[])[0]||''),
 thumbnailUrl:row.media_type==='video'?((Array.isArray(row.images)?row.images:[])[0]||''):row.media_url||((Array.isArray(row.images)?row.images:[])[0]||''),
 mediaType:row.media_type==='video'?'video':'image',
 store:{id:row.store_id,slug:row.store_slug,name:row.store_name,logoUrl:row.logo_url||''}
})
async function discover(req,res){
 if(!pool)return res.status(503).json({error:'Busca indisponível.'})
 const q=clean(req.query.q,100), category=clean(req.query.category,80),mode=clean(req.query.mode,12)
 const min=clean(req.query.minPrice,16),max=clean(req.query.maxPrice,16)
 if(mode && !['varejo','atacado'].includes(mode))return res.status(400).json({error:'Modalidade inválida.'})
 const priceFilter=min!==''||max!==''
 const minimum=min===''?null:Number(min),maximum=max===''?null:Number(max)
 if(priceFilter && ([minimum,maximum].some(x=>x!==null&&(!Number.isFinite(x)||x<0||x>100000000))||(minimum!==null&&maximum!==null&&minimum>maximum)))
   return res.status(400).json({error:'Confira a faixa de preço.'})
 const account=await currentSocialBuyer(req)
 if(priceFilter && !account)return failure(res)
 const term=like(q)
 const args=[term,category,mode]
 let priceWhere=''
 if(priceFilter){
   args.push(minimum,maximum)
   priceWhere=`AND EXISTS (
     SELECT 1 FROM catalogs c
     LEFT JOIN catalog_products cp ON cp.catalog_id=c.id AND cp.product_id=p.id
     WHERE c.store_id=s.id AND c.active=true
       AND (c.is_default OR s.plan_tier='ouro')
       AND (CASE WHEN c.explicit_membership THEN cp.visible=true ELSE COALESCE(cp.visible,true)=true END)
       AND ($3::text='' OR c.kind=$3)
       AND ($4::numeric IS NULL OR COALESCE(cp.price_override,CASE WHEN c.kind='varejo' THEN p.retail_price WHEN c.kind='atacado' THEN p.box_price END,p.price)>=$4)
       AND ($5::numeric IS NULL OR COALESCE(cp.price_override,CASE WHEN c.kind='varejo' THEN p.retail_price WHEN c.kind='atacado' THEN p.box_price END,p.price)<=$5)
   )`
 }
 const base=`FROM products p JOIN stores s ON s.id=p.store_id
   WHERE p.active=true AND p.social_published=true AND s.is_active=true AND s.social_enabled=true
     AND ($1::text='%%' OR p.name ILIKE $1 ESCAPE '\\' OR p.sku ILIKE $1 ESCAPE '\\' OR p.category ILIKE $1 ESCAPE '\\' OR s.name ILIKE $1 ESCAPE '\\')
     AND ($2::text='' OR p.category=$2)
     AND ($3::text='' OR EXISTS (SELECT 1 FROM catalogs c LEFT JOIN catalog_products cp ON cp.catalog_id=c.id AND cp.product_id=p.id
       WHERE c.store_id=s.id AND c.active=true AND (c.is_default OR s.plan_tier='ouro')
         AND (CASE WHEN c.explicit_membership THEN cp.visible=true ELSE COALESCE(cp.visible,true)=true END) AND c.kind=$3))
     ${priceWhere}`
 const [products,stores,categories]=await Promise.all([
   pool.query(`SELECT p.id,p.name,p.sku,p.category,p.media_url,p.media_type,p.images,
     s.id AS store_id,s.slug AS store_slug,s.name AS store_name,s.logo_url ${base}
     ORDER BY p.social_published_at DESC,p.id DESC LIMIT 36`,args),
   pool.query(`SELECT s.id,s.slug,s.name,s.logo_url,s.tagline,
     (SELECT count(*)::int FROM products p WHERE p.store_id=s.id AND p.active=true AND p.social_published=true) AS product_count
     FROM stores s WHERE s.is_active=true AND s.social_enabled=true
       AND ($1::text='%%' OR s.name ILIKE $1 ESCAPE '\\' OR s.slug ILIKE $1 ESCAPE '\\')
     ORDER BY s.name ASC LIMIT 12`,[term]),
   pool.query(`SELECT category FROM products p JOIN stores s ON s.id=p.store_id
     WHERE p.active=true AND p.social_published=true AND s.is_active=true AND s.social_enabled=true
     GROUP BY category ORDER BY count(*) DESC,category ASC LIMIT 24`)
 ])
 if(account){noCache(res);res.set('Vary','Cookie')}
 else res.set('Cache-Control','public, max-age=30')
 let priceMap=new Map()
 if(account&&products.rows.length){
   const offers=await pool.query(`
    SELECT p.id AS product_id,MIN(COALESCE(cp.price_override,
       CASE WHEN c.kind='varejo' THEN p.retail_price WHEN c.kind='atacado' THEN p.box_price END,p.price))::numeric AS display_price,
       COUNT(*)::int AS catalog_count
    FROM products p JOIN stores s ON s.id=p.store_id
      JOIN catalogs c ON c.store_id=s.id AND c.active=true AND (c.is_default OR s.plan_tier='ouro')
      LEFT JOIN catalog_products cp ON cp.catalog_id=c.id AND cp.product_id=p.id
    WHERE p.id=ANY($1::text[]) AND (CASE WHEN c.explicit_membership THEN cp.visible=true ELSE COALESCE(cp.visible,true)=true END)
      AND ($2::text='' OR c.kind=$2)
    GROUP BY p.id`,[products.rows.map(x=>x.id),mode])
   priceMap=new Map(offers.rows.map(x=>[x.product_id,{price:Number(x.display_price),multiple:Number(x.catalog_count)>1}]))
 }
 return res.json({products:products.rows.map(row=>{
   const shape=productShape(row),quote=priceMap.get(row.id)
   return quote?{...shape,price:quote.price,priceFrom:quote.multiple}:shape
 }),
   stores:stores.rows.map(x=>({id:x.id,slug:x.slug,name:x.name,logoUrl:x.logo_url||'',tagline:x.tagline||'',productCount:Number(x.product_count||0)})),
   categories:categories.rows.map(x=>x.category),pricesVisible:Boolean(account)})
}
async function saved(req,res){
 noCache(res)
 const buyer=await currentSocialBuyer(req)
 if(!buyer)return failure(res)
 await ensureSaved()
 const [products,stores]=await Promise.all([
   pool.query(`SELECT p.id,p.name,p.sku,p.category,p.media_url,p.media_type,p.images,
     s.id AS store_id,s.slug AS store_slug,s.name AS store_name,s.logo_url
     FROM buyer_saved_products b JOIN products p ON p.id=b.product_id JOIN stores s ON s.id=p.store_id
     WHERE b.buyer_id=$1 AND p.active=true AND p.social_published=true AND s.is_active=true AND s.social_enabled=true
     ORDER BY b.created_at DESC LIMIT 100`,[buyer.id]),
   pool.query(`SELECT s.id,s.slug,s.name,s.logo_url,s.tagline,
       (SELECT count(*)::int FROM products p WHERE p.store_id=s.id AND p.active=true AND p.social_published=true) AS product_count
     FROM social_store_follows f JOIN stores s ON s.id=f.store_id
     WHERE f.visitor_key=$1 AND s.is_active=true AND s.social_enabled=true
     ORDER BY s.name ASC LIMIT 100`,['buyer:'+buyer.id])
 ])
 return res.json({products:products.rows.map(productShape),stores:stores.rows.map(x=>({
    id:x.id,slug:x.slug,name:x.name,logoUrl:x.logo_url||'',tagline:x.tagline||'',productCount:Number(x.product_count||0)
 }))})
}
async function saveProduct(req,res){
 noCache(res)
 const buyer=await currentSocialBuyer(req)
 if(!buyer)return failure(res)
 await ensureSaved()
 const productId=clean(req.body?.productId,100)
 if(!productId)return res.status(400).json({error:'Produto não informado.'})
 if(req.body?.saved===false){
   await pool.query('DELETE FROM buyer_saved_products WHERE buyer_id=$1 AND product_id=$2',[buyer.id,productId])
   return res.json({saved:false})
 }
 const found=await pool.query(`SELECT p.id FROM products p JOIN stores s ON s.id=p.store_id
   WHERE p.id=$1 AND p.active=true AND p.social_published=true AND s.is_active=true AND s.social_enabled=true LIMIT 1`,[productId])
 if(!found.rowCount)return res.status(404).json({error:'Produto indisponível.'})
 await pool.query('INSERT INTO buyer_saved_products(buyer_id,product_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[buyer.id,productId])
 return res.json({saved:true})
}
async function orders(req,res){
 noCache(res)
 const buyer=await currentSocialBuyer(req)
 if(!buyer)return failure(res)
 const result=await pool.query(`SELECT o.id,o.code,o.total,o.status,o.items,o.created_at,c.name AS catalog_name,
   s.id AS store_id,s.name AS store_name,s.slug AS store_slug,s.logo_url AS store_logo
   FROM orders o JOIN store_customers sc ON sc.id=o.customer_id
     JOIN stores s ON s.id=o.store_id LEFT JOIN catalogs c ON c.id=o.catalog_id
   WHERE sc.buyer_account_id=$1 ORDER BY o.created_at DESC,o.id DESC LIMIT 100`,[buyer.id])
 return res.json({orders:result.rows.map(o=>({
   id:o.id,code:o.code,total:Number(o.total),status:o.status,createdAt:o.created_at,
   catalogName:o.catalog_name||'',store:{id:o.store_id,slug:o.store_slug,name:o.store_name,logoUrl:o.store_logo||''},
   items:Array.isArray(o.items)?o.items.slice(0,50).map(i=>({name:i.name,quantity:i.quantity,lineTotal:i.lineTotal})):[],
 }))})
}
function install(app){
 if(app.__shopvaxBuyerDiscoveryInstalled)return
 app.__shopvaxBuyerDiscoveryInstalled=true
 app.get('/api/social/discover',wrap(discover))
 app.get('/api/social/buyer/saved',wrap(saved))
 app.post('/api/social/buyer/saved',express.json({limit:'8kb'}),wrap(saveProduct))
 app.get('/api/social/buyer/orders',wrap(orders))
}
const old=express.application.init
express.application.init=function socialDiscoveryInit(...args){
 const r=old.apply(this,args);install(this);return r
}

/**
 * Export MAMA's OCR-missed photos from the existing, isolated import review
 * as local image files + a manifest for independent human/vision inspection.
 * This is read-only. It does not publish or change a single product.
 *
 * Usage: node scripts/mama-export-visual-review.mjs
 *        node scripts/mama-export-visual-review.mjs --all
 * Output: /tmp/mama-visual-review/{manifest.json,photos/*.webp}
 * Archive: tar -czf /tmp/mama-visual-review.tar.gz -C /tmp mama-visual-review
 *
 * The images are the actual locally staged Google Photos copies, not tiny
 * Linktree previews; no image data is committed to the public repository.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'
import sharp from 'sharp'
import { links } from './mama-public-album-links.mjs'
import { canonicalMamaName, MAMA_IMPORT_MARKER } from '../server/mama-import-plan.mjs'

const allPhotos = process.argv.includes('--all')
const outDir = '/tmp/mama-visual-review'
const photosDir = path.join(outDir,'photos')
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:10000})
pool.on('error',e=>console.error('[mama export] pool:',e.message))

async function main() {
  if(!process.env.DATABASE_URL)throw Error('DATABASE_URL ausente.')
  const found=await pool.query("SELECT id,name FROM stores WHERE lower(name) LIKE '%mama%'")
  const matches=found.rows.filter(row=>canonicalMamaName(row.name)==='mama acessorios')
  if(matches.length!==1)throw Error('A conta exata Mama Acessórios não é única ou não existe.')
  const storeId=matches[0].id
  await mkdir(photosDir,{recursive:true})
  const records=[]
  const albumStats=[]
  for(let i=0;i<links.length;i++) {
    const [album,url]=links[i]
    const jobs=await pool.query(
      'SELECT id,status FROM import_jobs WHERE store_id=$1 AND source_url=$2 AND source_host=$3 ORDER BY created_at DESC LIMIT 1',
      [storeId,url,MAMA_IMPORT_MARKER])
    if(!jobs.rowCount){
      albumStats.push({album,status:'not_collected'})
      continue
    }
    const job=jobs.rows[0]
    if(!['review','completed'].includes(job.status)){
      albumStats.push({album,status:job.status})
      continue
    }
    const items=await pool.query(
      'SELECT n.id,n.selected,COALESCE(n.review_data,n.normalized_data) AS product,'+
      "c.raw_data->>'external_id' AS external_id "+
      'FROM import_normalized_products n JOIN import_candidates c '+
      'ON n.source_candidate_id=c.id AND n.store_id=c.store_id '+
      'WHERE n.job_id=$1 AND n.store_id=$2 ORDER BY n.created_at,n.id',
      [job.id,storeId])
    let photos=0
    for(const item of items.rows) {
      const product=item.product||{}
      const price=product.price==null?null:Number(product.price)
      const knownPrice=Number.isFinite(price) && price>0
      if(!allPhotos && knownPrice)continue
      const media=String(product.media_url||product.images?.[0]||'')
      const mediaId=/^\/media\/([0-9a-f-]{36})$/i.exec(media)?.[1]
      const external=String(item.external_id||'')
      const fileName='album-'+String(i+1).padStart(2,'0')+'-'+external.replace(/[^a-zA-Z0-9_-]/g,'')+'.webp'
      const record={album,albumUrl:url,externalId:external,jobId:job.id,
        name:String(product.name||''),recognizedPrice:knownPrice?price:null,
        file:'photos/'+fileName,status:'saved'}
      if(!mediaId){
        record.status='no_local_image'
        delete record.file
        records.push(record)
        continue
      }
      const image=await pool.query('SELECT data FROM media_assets WHERE id=$1 AND store_id=$2',
        [mediaId,storeId])
      if(!image.rows[0]?.data){
        record.status='image_not_found'
        delete record.file
        records.push(record)
        continue
      }
      await writeFile(path.join(photosDir,fileName),
        await sharp(image.rows[0].data).rotate().webp({quality:91}).toBuffer())
      photos++
      records.push(record)
    }
    albumStats.push({album,status:job.status,jobId:job.id,
      products:items.rowCount,exported:photos})
    console.log('[mama export] '+album+': '+photos+' fotos')
  }
  const report={
    purpose:'Visual read of real price tags missed by OCR; no guesses',
    generatedAt:new Date().toISOString(),
    store:'Mama Acessórios',
    allPhotos,albums:albumStats,photos:records,
  }
  await writeFile(path.join(outDir,'manifest.json'),JSON.stringify(report,null,2))
  const failures=records.filter(x=>x.status!=='saved')
  console.log('MAMA_VISUAL_EXPORT '+JSON.stringify({
    albums:albumStats.length,photos:records.length,
    saved:records.length-failures.length,failures:failures.length,
    folder:outDir,archiveCommand:'tar -czf /tmp/mama-visual-review.tar.gz -C /tmp mama-visual-review',
  }))
  if(failures.length)process.exitCode=1
}

try { await main() }
catch(e){console.error('[mama export]',e.message||e);process.exitCode=1}
finally{await pool.end()}

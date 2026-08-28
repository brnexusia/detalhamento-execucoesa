from pathlib import Path

p=Path('server/scanner-hooks.mjs')
s=p.read_text()
anchor="""  router.get('/', requireStore, asyncRoute(async (req, res) => {
    const result = await pool.query(`SELECT * FROM import_jobs WHERE store_id=$1 ORDER BY created_at DESC LIMIT 10`, [req.scannerStore.store_id])
    res.json({ jobs: result.rows.map(publicJob) })
  }))
"""
insert=anchor+"""

  router.delete('/:jobId', requireStore, asyncRoute(async (req, res) => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const job = await client.query(
        'SELECT id,status FROM import_jobs WHERE id=$1 AND store_id=$2 LIMIT 1 FOR UPDATE',
        [req.params.jobId, req.scannerStore.store_id],
      )
      if (!job.rowCount) {
        await client.query('ROLLBACK')
        return res.status(404).json({ error: 'Importação não encontrada.' })
      }
      await client.query("UPDATE import_jobs SET status='cancelled',updated_at=now() WHERE id=$1 AND store_id=$2", [req.params.jobId, req.scannerStore.store_id])
      await client.query('DELETE FROM import_jobs WHERE id=$1 AND store_id=$2', [req.params.jobId, req.scannerStore.store_id])
      await client.query('COMMIT')
      res.json({ ok: true })
    } catch (error) {
      try { await client.query('ROLLBACK') } catch {}
      throw error
    } finally {
      client.release()
    }
  }))
"""
if "router.delete('/:jobId'" not in s:
    if anchor not in s: raise SystemExit('server anchor missing')
    s=s.replace(anchor,insert)
old="""      if (!rows.length) continue
      await pool.query(
        `INSERT INTO import_candidates (id,job_id,store_id,source_key,source_url,raw_data)
"""
new="""      if (!rows.length) continue
      const stillActive = await pool.query("SELECT 1 FROM import_jobs WHERE id=$1 AND store_id=$2 AND status='scanning' LIMIT 1", [job.id, job.store_id])
      if (!stillActive.rowCount) return
      await pool.query(
        `INSERT INTO import_candidates (id,job_id,store_id,source_key,source_url,raw_data)
"""
if old in s and 'const stillActive = await pool.query' not in s:
    s=s.replace(old,new)
p.write_text(s)

p=Path('src/api.ts'); s=p.read_text()
anchor="  createImportJob: (url: string) => request<{ job: ImportJob; duplicated: boolean }>('/api/admin/imports', { method: 'POST', body: JSON.stringify({ url }) }),\n"
if 'discardImportJob:' not in s:
    if anchor not in s: raise SystemExit('api anchor missing')
    s=s.replace(anchor,anchor+"  discardImportJob: (jobId: string) => request<{ ok: true }>(`/api/admin/imports/${encodeURIComponent(jobId)}`, { method: 'DELETE' }),\n")
p.write_text(s)

p=Path('src/ScannerModule1.tsx'); s=p.read_text()
s=s.replace('  Search,\n  X,', '  Search,\n  Trash2,\n  X,')
anchor="  const [success, setSuccess] = useState('')\n"
if 'discardingId' not in s:
    s=s.replace(anchor,anchor+"  const [discardingId, setDiscardingId] = useState<string | null>(null)\n")
anchor='  const openReview = async (job: ImportJob) => {\n'
fn="""  const discardImport = async (job: ImportJob) => {
    const label = job.status === 'completed'
      ? 'Isso apaga somente o histórico e os dados temporários da importação. Produtos já publicados continuam no catálogo.'
      : 'Isso apaga esta importação e todos os dados temporários coletados. Essa ação não pode ser desfeita.'
    if (!window.confirm(`Descartar importação de ${job.source_host}?\\n\\n${label}`)) return
    setDiscardingId(job.id)
    setError('')
    setSuccess('')
    try {
      await api.discardImportJob(job.id)
      if (reviewJob?.id === job.id) backToImports()
      else await loadJobs()
      setSuccess('Importação descartada e dados temporários removidos.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível descartar a importação.')
    } finally {
      setDiscardingId(null)
    }
  }

"""
if 'const discardImport = async' not in s:
    if anchor not in s: raise SystemExit('ui function anchor missing')
    s=s.replace(anchor,fn+anchor)
old="""                {job.status === 'review' && <button type=\"button\" className=\"scanner-review-open\" onClick={() => void openReview(job)}>Revisar</button>}
                <span data-status={job.status}>"""
new="""                {job.status === 'review' && <button type=\"button\" className=\"scanner-review-open\" onClick={() => void openReview(job)}>Revisar</button>}
                <button type=\"button\" className=\"scanner-discard\" disabled={discardingId === job.id} onClick={() => void discardImport(job)} title=\"Apagar esta importação\"><Trash2 size={14} /> {discardingId === job.id ? 'Descartando…' : 'Descartar'}</button>
                <span data-status={job.status}>"""
if 'className="scanner-discard"' not in s:
    if old not in s: raise SystemExit('ui action anchor missing')
    s=s.replace(old,new)
p.write_text(s)

p=Path('src/scanner-module1.css'); s=p.read_text()
if '.scanner-discard' not in s:
    s += """

.scanner-discard {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  background: transparent;
  padding: 6px 7px;
  color: #8b3a2d;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  opacity: .82;
}
.scanner-discard:hover:not(:disabled) { opacity: 1; text-decoration: underline; }
.scanner-discard:disabled { cursor: wait; opacity: .45; }
"""
p.write_text(s)

Path('server/scanner-discard.integration.mjs').write_text(r"""import assert from 'node:assert/strict'
import pg from 'pg'
import { processImportJob, processNormalizationJob } from './scanner-hooks.mjs'
const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
async function register(label) {
  const r=await fetch(`${base}/api/auth/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:`Discard ${label}`,email:`discard-${label}-${Date.now()}-${Math.random()}@example.test`,password:'scanner1234',storeName:`Discard ${label}`,whatsapp:'5511999999999'})})
  assert.equal(r.status,201); return r.headers.get('set-cookie')?.split(';')[0]
}
async function api(path,cookie,options={}) { return fetch(`${base}${path}`,{...options,headers:{'Content-Type':'application/json',Cookie:cookie,...(options.headers||{})}}) }
const cookie=await register('a')
let r=await api('/api/admin/imports',cookie,{method:'POST',body:JSON.stringify({url:'https://discard.fixture.example/'})}); let p=await r.json(); const jobId=p.job.id
const collector=async()=>({platform:'generic',pagesScanned:1,candidates:[{source_url:'https://discard.fixture.example/p/1',external_id:'p1',title:'Produto descartável',sku:'D1',category:'Teste',images:['https://cdn.fixture.example/d1.jpg'],properties:[],variants:[],price:10,currency:'BRL',source:'fixture'}]})
await processImportJob(jobId,collector); await processNormalizationJob(jobId)
let counts=await pool.query(`SELECT (SELECT count(*) FROM import_jobs WHERE id=$1)::int jobs,(SELECT count(*) FROM import_candidates WHERE job_id=$1)::int candidates,(SELECT count(*) FROM import_normalized_products WHERE job_id=$1)::int normalized`,[jobId])
assert.deepEqual(counts.rows[0],{jobs:1,candidates:1,normalized:1})
r=await api(`/api/admin/imports/${jobId}`,cookie,{method:'DELETE'}); assert.equal(r.status,200)
counts=await pool.query(`SELECT (SELECT count(*) FROM import_jobs WHERE id=$1)::int jobs,(SELECT count(*) FROM import_candidates WHERE job_id=$1)::int candidates,(SELECT count(*) FROM import_normalized_products WHERE job_id=$1)::int normalized`,[jobId])
assert.deepEqual(counts.rows[0],{jobs:0,candidates:0,normalized:0})
r=await api(`/api/admin/imports/${jobId}`,cookie,{method:'DELETE'}); assert.equal(r.status,404)

r=await api('/api/admin/imports',cookie,{method:'POST',body:JSON.stringify({url:'https://discard-completed.fixture.example/'})}); p=await r.json(); const completedId=p.job.id
await processImportJob(completedId,collector); await processNormalizationJob(completedId)
r=await api(`/api/admin/imports/${completedId}/publish`,cookie,{method:'POST',body:'{}'}); assert.equal(r.status,200)
r=await api('/api/admin/bootstrap',cookie); const before=(await r.json()).products.length; assert.ok(before>=1)
r=await api(`/api/admin/imports/${completedId}`,cookie,{method:'DELETE'}); assert.equal(r.status,200)
r=await api('/api/admin/bootstrap',cookie); const after=(await r.json()).products.length; assert.equal(after,before,'descartar histórico concluído não apaga produtos publicados')
await pool.end()
console.log('[scanner discard] cascade temp data + preserve published products: ok')
""")

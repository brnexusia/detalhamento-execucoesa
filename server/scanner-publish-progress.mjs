/**
 * Durable, database-backed publication queue.
 * Reports completed units, not elapsed time or a fabricated ETA.
 * Safe to poll from another API replica; a crashed worker can resume after
 * its lease expires. Products are still committed atomically by publisher.
 */
export const PUBLISH_PHASES = Object.freeze({
  queued:'Aguardando processamento',
  images:'Salvando fotografias',
  grouping:'Identificando produtos e variações',
  saving:'Preparando produtos no banco',
  committed:'Confirmando publicação',
  finished:'Catálogo publicado',
  failed:'Importação interrompida',
})

export function publicationPercent(phase,completed,total) {
  if (phase==='finished') return 100
  if (phase==='queued') return 0
  if (phase==='committed') return 99
  if (phase==='failed') return 0
  const bounded = total>0 ? Math.max(0,Math.min(1,Number(completed)/Number(total))) : 1
  if (phase==='images') return Math.floor(bounded*75)
  if (phase==='grouping') return 75+Math.floor(bounded*10)
  if (phase==='saving') return 85+Math.floor(bounded*14)
  return 0
}
export function publishProgress(row) {
  if (!row) return null
  return {
    jobId:row.job_id,
    state:row.state,
    phase:row.phase,
    message:PUBLISH_PHASES[row.phase] || 'Processando catálogo',
    completed:Number(row.completed||0),
    total:Number(row.total||0),
    percent:Number(row.percent||0),
    error:row.error||'',
    result:row.result||null,
    updatedAt:row.updated_at,
    heartbeatAt:row.heartbeat_at || null,
    attempts:Number(row.attempts || 0),
    catalogId:row.target_catalog_id || null,
  }
}
export function createPublishTaskQueue(pool) {
  let schemaPromise
  const ensure = () => {
    if (!schemaPromise) schemaPromise=pool.query(`
      CREATE TABLE IF NOT EXISTS import_publish_tasks(
        job_id text PRIMARY KEY REFERENCES import_jobs(id) ON DELETE CASCADE,
        store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        mode text NOT NULL DEFAULT 'grouped',
        target_catalog_id text,
        state text NOT NULL DEFAULT 'queued'
          CHECK(state IN ('queued','running','finished','failed')),
        phase text NOT NULL DEFAULT 'queued',
        completed integer NOT NULL DEFAULT 0,
        total integer NOT NULL DEFAULT 0,
        percent integer NOT NULL DEFAULT 0 CHECK(percent BETWEEN 0 AND 100),
        error text NOT NULL DEFAULT '',
        result jsonb,
        attempts integer NOT NULL DEFAULT 0,
        heartbeat_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE import_publish_tasks ADD COLUMN IF NOT EXISTS target_catalog_id text;
      CREATE INDEX IF NOT EXISTS idx_import_publish_task_pending
        ON import_publish_tasks(state,updated_at)
        WHERE state IN ('queued','running');
    `).catch(error=>{schemaPromise=null;throw error})
    return schemaPromise
  }
  return {
    ensure,
    async enqueue(jobId,storeId,mode,catalogId) {
      if (!catalogId) throw new Error('Selecione o catálogo de destino antes de publicar.')
      await ensure()
      const result=await pool.query(`
        INSERT INTO import_publish_tasks(job_id,store_id,mode,target_catalog_id)
        VALUES($1,$2,$3,$4)
        ON CONFLICT(job_id) DO UPDATE SET
          mode=EXCLUDED.mode,target_catalog_id=EXCLUDED.target_catalog_id,state='queued',phase='queued',
          completed=0,total=0,percent=0,error='',result=NULL,
          heartbeat_at=NULL,updated_at=now()
        WHERE import_publish_tasks.state='failed'
        RETURNING *
      `,[jobId,storeId,mode,catalogId])
      if (result.rowCount) return publishProgress(result.rows[0])
      return this.get(jobId,storeId)
    },
    async get(jobId,storeId) {
      await ensure()
      const result=await pool.query(
        'SELECT * FROM import_publish_tasks WHERE job_id=$1 AND store_id=$2',
        [jobId,storeId])
      return publishProgress(result.rows[0])
    },
    async claim() {
      await ensure()
      // Exactly one process claims a task even with several ShopVax replicas.
      const result=await pool.query(`
        WITH claimed AS (
          SELECT job_id FROM import_publish_tasks
          WHERE state='queued'
            OR (state='running' AND heartbeat_at < now()-interval '5 minutes')
          ORDER BY updated_at ASC
          FOR UPDATE SKIP LOCKED LIMIT 1
        )
        UPDATE import_publish_tasks t SET
          state='running',phase='queued',error='',completed=0,total=0,
          percent=0,heartbeat_at=now(),updated_at=now(),attempts=attempts+1
        FROM claimed WHERE t.job_id=claimed.job_id RETURNING t.*
      `)
      return result.rows[0]||null
    },
    async heartbeat(jobId) {
      await pool.query(`
        UPDATE import_publish_tasks SET heartbeat_at=now()
        WHERE job_id=$1 AND state='running'
      `,[jobId])
    },
    async update(jobId,event) {
      const phase=event.phase
      const completed=Math.max(0,Math.floor(Number(event.completed)||0))
      const total=Math.max(0,Math.floor(Number(event.total)||0))
      const percent=publicationPercent(phase,completed,total)
      await pool.query(`
        UPDATE import_publish_tasks SET phase=$2,completed=$3,total=$4,
          percent=GREATEST(percent,$5),heartbeat_at=now(),updated_at=now()
        WHERE job_id=$1 AND state='running'
      `,[jobId,phase,completed,total,percent])
    },
    async finish(jobId,result) {
      await pool.query(`
        UPDATE import_publish_tasks SET state='finished',phase='finished',
          percent=100,result=$2::jsonb,error='',heartbeat_at=now(),updated_at=now()
        WHERE job_id=$1 AND state='running'
      `,[jobId,JSON.stringify(result)])
    },
    async fail(jobId,error) {
      await pool.query(`
        UPDATE import_publish_tasks SET state='failed',phase='failed',
          error=$2,heartbeat_at=now(),updated_at=now()
        WHERE job_id=$1 AND state='running'
      `,[jobId,String(error||'Falha ao importar.').slice(0,700)])
    },
  }
}

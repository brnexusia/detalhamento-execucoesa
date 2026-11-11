/**
 * Scanner jobs are streamed to import_candidates. A crash/redeploy previously
 * left them stuck in 'scanning' forever. A live worker renews scan_lease_at;
 * only expired leases are safely requeued and scanned again from the start.
 */
export async function requeueInterruptedScans(query) {
  const result = await query(
    `UPDATE import_jobs
     SET status='queued',
         progress=CASE WHEN scan_next_page>1 THEN progress ELSE 0 END,
         result_count=CASE WHEN scan_next_page>1 THEN result_count ELSE 0 END,
         pages_scanned=CASE WHEN scan_next_page>1 THEN pages_scanned ELSE 0 END,
         error='',scan_worker_token=NULL,scan_lease_at=NULL,updated_at=now()
     WHERE status='scanning'
       AND (
         COALESCE(scan_lease_at,updated_at) < now()-interval '120 seconds'
         OR (COALESCE(platform,'')<>'pdf' AND updated_at < now()-interval '300 seconds')
       )
     RETURNING id`,
  )
  // Keep PostgreSQL's QueryResult shape. Older scanner workers consumed
  // "orphaned.rows" directly, while newer schedulers also accept bare rows.
  // Returning the original result makes mixed rolling deployments compatible.
  return { rows: Array.isArray(result?.rows) ? result.rows : [] }
}


/**
 * One bounded, automatic recovery of a failed FácilZap import caused by a
 * transient network failure. The last completed page is preserved by the
 * collector; old/non-network failures and newer replacement jobs are untouched.
 * This makes a recently failed user job recover after the corrected deployment
 * without a button or terminal command.
 */
export async function requeueFailedTransientFacilZapScans(query) {
  const result = await query(
    `UPDATE import_jobs j
     SET status='queued',error='',scan_worker_token=NULL,scan_lease_at=NULL,
         progress=CASE WHEN j.scan_next_page>1 THEN j.progress ELSE 0 END,
         result_count=CASE WHEN j.scan_next_page>1 THEN j.result_count ELSE 0 END,
         pages_scanned=CASE WHEN j.scan_next_page>1 THEN j.pages_scanned ELSE 0 END,
         scan_network_retries=j.scan_network_retries+1,updated_at=now()
     WHERE j.status='failed'
       AND j.platform='facilzap'
       AND j.source_host IN ('facilzap.com.br','www.facilzap.com.br','facilzap.app.br')
       AND j.scan_network_retries < 2
       AND j.created_at >= now()-interval '8 hours'
       AND j.updated_at < now()-interval '20 seconds'
       AND j.error ~* '(ECONNRESET|ETIMEDOUT|EPIPE|EAI_AGAIN|socket hang up|response interrupted|resposta interrompida|demorou demais|HTTP (408|425|429|500|502|503|504))'
       AND NOT EXISTS (
         SELECT 1 FROM import_jobs newer
         WHERE newer.store_id=j.store_id
           AND newer.source_url=j.source_url
           AND (newer.created_at, newer.id) > (j.created_at,j.id)
       )
     RETURNING j.id`,
  )
  return { rows: Array.isArray(result?.rows) ? result.rows : [] }
}

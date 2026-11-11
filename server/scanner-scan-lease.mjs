/**
 * Scanner jobs are streamed to import_candidates. A crash/redeploy previously
 * left them stuck in 'scanning' forever. A live worker renews scan_lease_at;
 * only expired leases are safely requeued and scanned again from the start.
 */
export async function requeueInterruptedScans(query) {
  const result = await query(
    `UPDATE import_jobs
     SET status='queued',progress=0,result_count=0,pages_scanned=0,
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


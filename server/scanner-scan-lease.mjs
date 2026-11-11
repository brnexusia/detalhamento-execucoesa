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
       AND COALESCE(scan_lease_at,updated_at) < now()-interval '120 seconds'
     RETURNING id`,
  )
  return result.rows || []
}

/**
 * Store-scoped on-demand retry for the admin UI. Refuses active scans whose
 * heartbeat has been renewed within the last two minutes.
 * A partially scanned catalog is NOT promoted to review: its queued worker
 * rebuilds candidate rows from the source.
 */
export async function retryInterruptedScan(query, { jobId, storeId }) {
  const result = await query(
    `UPDATE import_jobs
     SET status='queued',progress=0,result_count=0,pages_scanned=0,
         error='',scan_worker_token=NULL,scan_lease_at=NULL,updated_at=now()
     WHERE id=$1 AND store_id=$2 AND status='scanning'
       AND COALESCE(scan_lease_at,updated_at) < now()-interval '120 seconds'
     RETURNING id`,
    [jobId, storeId],
  )
  return (result.rows || [])[0] || null
}

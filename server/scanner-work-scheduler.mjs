/**
 * The import queue must not serialize PDFs behind a slow storefront crawl.
 * Scheduling is short-lived: long-running jobs are launched in independent
 * bounded lanes; the next polling tick still checks expired scan leases.
 * Database claim predicates in each worker own cross-replica exclusivity.
 */
export function createScannerWorkScheduler({
  ensureSchema, recover, findNext, processScan, processNormalization,
  log = (message, error) => console.error(message, error),
}) {
  let polling = false
  const running = new Map()
  const launch = (lane, jobId) => {
    if (running.has(lane)) return
    // Unique ownership prevents a stale worker's finally from clearing
    // a newer attempt of the same job after automatic lease recovery.
    const attempt = { jobId }
    running.set(lane, attempt)
    void Promise.resolve()
      .then(() => lane === 'normalization' ? processNormalization(jobId) : processScan(jobId))
      .catch(error => log('[scanner] ' + lane + ' worker:', error))
      .finally(() => {
        if (running.get(lane) === attempt) running.delete(lane)
      })
  }

  return {
    async tick() {
      if (polling) return
      polling = true
      try {
        await ensureSchema()
        let recovered
        try {
          recovered = await recover()
        } catch (error) {
          // A broken recovery query must not block all new website/PDF jobs.
          log('[scanner] stalled-job recovery failed; continuing import queue:', error)
          recovered = []
        }
        // Accept both the older rows-array return and PostgreSQL QueryResult.
        // A rolling deploy must never disable imports over a .rows mismatch.
        const abandoned = Array.isArray(recovered) ? recovered
          : Array.isArray(recovered?.rows) ? recovered.rows : []
        for (const row of abandoned) {
          log('[scanner] restarting interrupted scan:', row.id)
          // A scan could be stuck in a hung promise inside this process. Once
          // its DB lease is revoked, open the lane for the recovered attempt.
          for (const [lane, attempt] of running.entries()) {
            if (lane !== 'normalization' && attempt.jobId === row.id) running.delete(lane)
          }
        }
        // No lane awaits another lane's work: scanning a 600-item website
        // must never prevent a PDF or normalization from beginning.
        for (const lane of ['normalization', 'pdf', 'site']) {
          if (running.has(lane)) continue
          const job = await findNext(lane)
          if (job?.id) launch(lane, job.id)
        }
      } finally {
        polling = false
      }
    },
    active: () => Object.fromEntries([...running].map(([lane, attempt]) => [lane, attempt.jobId])),
  }
}

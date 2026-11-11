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
    running.set(lane, jobId)
    void Promise.resolve()
      .then(() => lane === 'normalization' ? processNormalization(jobId) : processScan(jobId))
      .catch(error => log('[scanner] ' + lane + ' worker:', error))
      .finally(() => {
        if (running.get(lane) === jobId) running.delete(lane)
      })
  }

  return {
    async tick() {
      if (polling) return
      polling = true
      try {
        await ensureSchema()
        const abandoned = await recover()
        for (const row of abandoned || []) log('[scanner] restarting interrupted scan:', row.id)
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
    active: () => Object.fromEntries(running),
  }
}

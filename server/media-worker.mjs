import { startRedisMediaWorker } from './redis-media-jobs.mjs'

const { shutdown } = startRedisMediaWorker({
  onError: (error) => console.error('[shopvax-media-worker]', error.message),
})
let stopping = false
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    if (stopping) return
    stopping = true
    shutdown().then(() => process.exit(0)).catch(() => process.exit(1))
  })
}

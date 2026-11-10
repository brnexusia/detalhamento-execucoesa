import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./scanner-hooks.mjs', import.meta.url), 'utf8')
function routeCode(route, nextRoute) {
  const start = source.indexOf(route)
  assert.ok(start >= 0, 'route not found: ' + route)
  const end = source.indexOf(nextRoute, start + route.length)
  assert.ok(end > start, 'following route not found: ' + nextRoute)
  return source.slice(start, end)
}
for (const [name, beginning, next] of [
  ['individual review', "router.patch('/:jobId/review/:productId'", "router.patch('/:jobId/review-selection'"],
  ['bulk review selection', "router.patch('/:jobId/review-selection'", "router.post('/', requireStore"],
]) {
  test(name + ' locks import_jobs before editing import_normalized_products', () => {
    const code = routeCode(beginning, next)
    const parentLock = code.indexOf('SELECT id,status FROM import_jobs WHERE id=$1 AND store_id=$2 FOR UPDATE')
    const childMutation = code.indexOf('UPDATE import_normalized_products')
    assert.ok(parentLock >= 0 && childMutation > parentLock,
      'The publisher locks import_jobs first. Review writes must acquire the same parent lock before child writes.')
    const statusGuard = code.indexOf("status !== 'review'")
    assert.ok(statusGuard > parentLock && statusGuard < childMutation,
      'Do not edit a review after publication begins')
  })
}

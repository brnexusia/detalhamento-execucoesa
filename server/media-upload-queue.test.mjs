import test from 'node:test'
import assert from 'node:assert/strict'
import { createMediaVariantQueue } from './media-upload-queue.mjs'

test('persiste variantes em fila assíncrona mantendo a ordem', async () => {
  const trace = []
  const queue = createMediaVariantQueue({
    generate: async (buffer, mimeType) => {
      trace.push(['generate', buffer.toString(), mimeType])
      return [{ width: 320, bytes: Buffer.from('tiny') }]
    },
    persist: async (id, variant) => { trace.push(['persist', id, variant.width]) },
  })
  const first = queue.enqueue('A', Buffer.from('a'), 'image/png')
  const second = queue.enqueue('B', Buffer.from('b'), 'image/jpeg')
  assert.equal(first.accepted, true)
  assert.equal(second.accepted, true)
  assert.deepEqual(await Promise.all([first.done, second.done]), [true, true])
  assert.deepEqual(trace, [
    ['generate', 'a', 'image/png'], ['persist', 'A', 320],
    ['generate', 'b', 'image/jpeg'], ['persist', 'B', 320],
  ])
})

test('uma otimização que falha não rejeita a promise nem bloqueia uploads seguintes', async () => {
  const warnings = []
  const queue = createMediaVariantQueue({
    generate: async (buffer) => {
      if (buffer.toString() === 'bad') throw new Error('imagem não suportada')
      return [{ width: 960 }]
    },
    persist: async () => {},
    onError: (error) => { warnings.push(error.message) },
  })
  const failed = queue.enqueue('A', Buffer.from('bad'), 'image/png')
  const next = queue.enqueue('B', Buffer.from('good'), 'image/jpeg')
  assert.equal(await failed.done, false)
  assert.equal(await next.done, true)
  assert.deepEqual(warnings, ['imagem não suportada'])
})

test('sobrecarga apenas dispensa otimização opcional e limita a RAM em fila', async () => {
  let release
  const held = new Promise((resolve) => { release = resolve })
  const queue = createMediaVariantQueue({
    generate: async () => { await held; return [] },
    persist: async () => {},
    maxPending: 1,
  })
  const accepted = queue.enqueue('A', Buffer.from('a'), 'image/png')
  const rejected = queue.enqueue('B', Buffer.from('b'), 'image/png')
  assert.equal(accepted.accepted, true)
  assert.equal(rejected.accepted, false)
  assert.equal(await rejected.done, false)
  release()
  assert.equal(await accepted.done, true)
})

test('erros do logger também não interrompem a fila', async () => {
  const queue = createMediaVariantQueue({
    generate: async () => { throw new Error('falha') },
    persist: async () => {},
    onError: () => { throw new Error('falha no log') },
  })
  const job = queue.enqueue('A', Buffer.from('a'), 'image/png')
  assert.equal(await job.done, false)
})

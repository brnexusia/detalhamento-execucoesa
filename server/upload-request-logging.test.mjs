import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { traceUpload } from './upload-request-logging.mjs'

function setup() {
  const messages = []
  let now = 1000
  const logger = {
    info: (message, details) => messages.push({ message, details }),
    warn: (message, details) => messages.push({ message, details }),
  }
  const req = { headers: { 'content-length': '1048576', cookie: 'secret=a', authorization: 'private' } }
  const res = new EventEmitter()
  res.setHeader = (name, value) => { res.headers = { ...res.headers, [name]: value } }
  res.statusCode = 202
  let nextCalls = 0
  const middleware = traceUpload('pdf', { logger, now: () => now, newId: () => 'trace-123' })
  middleware(req, res, () => { nextCalls++ })
  return { messages, req, res, setNow: (v) => { now = v }, nextCalls }
}

test('records upload start and successful completion with status and duration', () => {
  const x = setup()
  assert.equal(x.nextCalls, 1)
  assert.equal(x.res.headers['X-Upload-Request-ID'], 'trace-123')
  x.setNow(1150)
  x.res.emit('finish')
  x.res.emit('close')
  assert.deepEqual(x.messages.map(m => m.message), ['[upload] started', '[upload] finished'])
  assert.deepEqual(x.messages[1].details, {
    id: 'trace-123', kind: 'pdf', bytes: 1048576, status: 202, elapsedMs: 150,
  })
  assert.doesNotMatch(JSON.stringify(x.messages), /secret|private|authorization|cookie/)
})

test('records aborted connection even when there was no completed response', () => {
  const x = setup()
  x.setNow(1220)
  x.res.emit('close')
  assert.equal(x.messages.at(-1).message, '[upload] connection closed before response')
  assert.equal(x.messages.at(-1).details.elapsedMs, 220)
})

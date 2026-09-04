import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import {
  formatErrorWithCause,
  requestWithExplicitTimeout,
} from '../lib/long-running-http'

async function withServer(
  handler: http.RequestListener,
  run: (url: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

test('장시간 HTTP 클라이언트는 명시한 제한 안에서 JSON 응답을 반환한다', async () => {
  await withServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true }))
    }, 30)
  }, async (url) => {
    const response = await requestWithExplicitTimeout(url, {
      method: 'POST',
      body: '{}',
      timeoutMs: 1_000,
      label: 'test request',
    })
    assert.deepEqual(await response.json(), { ok: true })
  })
})

test('장시간 HTTP 클라이언트 timeout은 이름과 원인 코드를 보존한다', async () => {
  await withServer((_request, response) => {
    setTimeout(() => response.end('{}'), 100)
  }, async (url) => {
    await assert.rejects(
      requestWithExplicitTimeout(url, { timeoutMs: 20, label: 'slow request' }),
      (error: unknown) => {
        assert.match(formatErrorWithCause(error), /TimeoutError: slow request timed out after 20ms \[LONG_REQUEST_TIMEOUT\]/)
        return true
      },
    )
  })
})

test('중첩된 fetch 원인은 최상위 오류와 함께 출력한다', () => {
  const cause = Object.assign(new Error('Headers Timeout Error'), {
    name: 'HeadersTimeoutError',
    code: 'UND_ERR_HEADERS_TIMEOUT',
  })
  const error = new TypeError('fetch failed', { cause })
  assert.equal(
    formatErrorWithCause(error),
    'TypeError: fetch failed <- HeadersTimeoutError: Headers Timeout Error [UND_ERR_HEADERS_TIMEOUT]',
  )
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeTopicKey } from '../lib/suggest/normalize'
import {
  fetchPublishedTopicRows,
  PUBLISHED_TOPIC_CHUNK_SIZE,
} from '../lib/suggest/published-topic-query'

const url = 'https://example.supabase.co'
const key = 'test-service-role-key'
const makeIds = (count: number) => Array.from({ length: count }, (_, index) => `cluster-${index + 1}`)

function requestIds(input: string | URL | Request): string[] {
  const requestUrl = input instanceof Request ? new URL(input.url) : new URL(input)
  const filter = requestUrl.searchParams.get('id') ?? ''
  return filter.slice(4, -1).split(',').filter(Boolean)
}

function echoFetch(calls: number[][], topic = (id: string) => `Topic ${id}`) {
  return async (input: string | URL | Request) => {
    const ids = requestIds(input)
    calls.push(ids.map((id) => Number(id.replace('cluster-', ''))))
    return new Response(JSON.stringify(ids.map((id) => ({ id, topic: topic(id) }))))
  }
}

test('cluster 0개는 네트워크 요청 없이 빈 결과를 반환한다', async () => {
  let calls = 0
  const rows = await fetchPublishedTopicRows([], url, key, {
    fetchImpl: async () => {
      calls++
      return new Response('[]')
    },
  })
  assert.deepEqual(rows, [])
  assert.equal(calls, 0)
})

test('cluster 1개를 정상 조회한다', async () => {
  const calls: number[][] = []
  const rows = await fetchPublishedTopicRows(makeIds(1), url, key, { fetchImpl: echoFetch(calls) })
  assert.deepEqual(rows, [{ id: 'cluster-1', topic: 'Topic cluster-1' }])
  assert.deepEqual(calls, [[1]])
})

test('404개를 bounded chunk로 순차 조회한다', async () => {
  const calls: number[][] = []
  const rows = await fetchPublishedTopicRows(makeIds(404), url, key, { fetchImpl: echoFetch(calls) })
  assert.equal(rows.length, 404)
  assert.equal(calls.length, Math.ceil(404 / PUBLISHED_TOPIC_CHUNK_SIZE))
  assert.ok(calls.every((ids) => ids.length <= PUBLISHED_TOPIC_CHUNK_SIZE))
})

test('1,000개 이상도 요청당 최대 ID 수를 넘지 않고 순서를 유지한다', async () => {
  const ids = makeIds(1_051)
  const calls: number[][] = []
  const rows = await fetchPublishedTopicRows(ids, url, key, { fetchImpl: echoFetch(calls) })
  assert.deepEqual(rows.map((row) => row.id), ids)
  assert.equal(calls.length, Math.ceil(ids.length / PUBLISHED_TOPIC_CHUNK_SIZE))
  assert.equal(Math.max(...calls.map((chunk) => chunk.length)), PUBLISHED_TOPIC_CHUNK_SIZE)
})

test('중복 cluster ID는 안정적으로 한 번만 조회하고 반환한다', async () => {
  const calls: number[][] = []
  const rows = await fetchPublishedTopicRows(
    ['cluster-1', 'cluster-2', 'cluster-1', 'cluster-2'], url, key,
    { fetchImpl: echoFetch(calls) },
  )
  assert.deepEqual(rows.map((row) => row.id), ['cluster-1', 'cluster-2'])
  assert.deepEqual(calls, [[1, 2]])
})

test('중복 topic은 기존 정규화 Set 의미로 동일하게 제거된다', async () => {
  const calls: number[][] = []
  const rows = await fetchPublishedTopicRows(makeIds(2), url, key, {
    fetchImpl: echoFetch(calls, () => '  SAME Topic  '),
  })
  const keys = new Set(rows.map((row) => normalizeTopicKey(row.topic ?? '')))
  assert.equal(rows.length, 2)
  assert.deepEqual([...keys], ['same topic'])
})

test('chunk 경계 50/51에서 정확히 요청을 분할한다', async () => {
  const calls50: number[][] = []
  await fetchPublishedTopicRows(makeIds(50), url, key, { fetchImpl: echoFetch(calls50) })
  assert.deepEqual(calls50.map((ids) => ids.length), [50])
  const calls51: number[][] = []
  await fetchPublishedTopicRows(makeIds(51), url, key, { fetchImpl: echoFetch(calls51) })
  assert.deepEqual(calls51.map((ids) => ids.length), [50, 1])
})

test('중간 chunk의 첫 네트워크 실패 후 해당 chunk만 retry한다', async () => {
  const calls = new Map<string, number>()
  const rows = await fetchPublishedTopicRows(makeIds(120), url, key, {
    fetchImpl: async (input) => {
      const ids = requestIds(input)
      const firstId = ids[0]
      calls.set(firstId, (calls.get(firstId) ?? 0) + 1)
      if (firstId === 'cluster-51' && calls.get(firstId) === 1) {
        throw Object.assign(new Error('temporary'), { code: 'ECONNRESET' })
      }
      return new Response(JSON.stringify(ids.map((id) => ({ id, topic: id }))))
    },
    sleep: async () => {},
  })
  assert.equal(rows.length, 120)
  assert.deepEqual([...calls.values()], [1, 2, 1])
})

test('특정 chunk 최종 실패는 host, chunk, ID 수와 nested cause를 보존한다', async () => {
  await assert.rejects(
    fetchPublishedTopicRows(makeIds(120), url, key, {
      fetchImpl: async (input) => {
        const requestChunkIds = requestIds(input)
        if (requestChunkIds[0] === 'cluster-51') {
          throw new TypeError('fetch failed', {
            cause: Object.assign(new Error('connect timeout'), {
              code: 'ETIMEDOUT', address: '203.0.113.1', port: 443,
            }),
          })
        }
        return new Response(JSON.stringify(requestChunkIds.map((id) => ({ id, topic: id }))))
      },
      sleep: async () => {},
    }),
    /host=example\.supabase\.co chunk=2\/3 ids=50.*attempt=3\/3.*code=ETIMEDOUT.*port=443/,
  )
})

test('retry 불가능한 HTTP 오류를 chunk 문맥과 함께 구분한다', async () => {
  await assert.rejects(
    fetchPublishedTopicRows(makeIds(1), url, key, {
      fetchImpl: async () => new Response('{"message":"forbidden"}', { status: 403 }),
    }),
    /HTTP 403.*chunk=1\/1 ids=1/,
  )
})

test('일시적인 HTTP 503은 retry 후 최종 오류를 반환한다', async () => {
  let calls = 0
  await assert.rejects(
    fetchPublishedTopicRows(makeIds(1), url, key, {
      fetchImpl: async () => {
        calls++
        return new Response('{"message":"unavailable"}', { status: 503 })
      },
      sleep: async () => {},
    }),
    /HTTP 503/,
  )
  assert.equal(calls, 3)
})

test('잘못된 JSON 응답을 즉시 구분한다', async () => {
  let calls = 0
  await assert.rejects(
    fetchPublishedTopicRows(makeIds(1), url, key, {
      fetchImpl: async () => {
        calls++
        return new Response('not-json')
      },
    }),
    /JSON 오류.*chunk=1\/1 ids=1/,
  )
  assert.equal(calls, 1)
})

test('timeout은 제한된 retry 후 nested cause와 함께 실패한다', async () => {
  let calls = 0
  await assert.rejects(
    fetchPublishedTopicRows(makeIds(1), url, key, {
      fetchImpl: async () => {
        calls++
        throw new DOMException('request timed out', 'TimeoutError')
      },
      sleep: async () => {},
    }),
    /TimeoutError.*request timed out/,
  )
  assert.equal(calls, 3)
})

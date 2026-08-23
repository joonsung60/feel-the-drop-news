export type PublishedTopicRow = { id: string; topic: string | null }

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

type PublishedTopicQueryOptions = {
  fetchImpl?: FetchLike
  timeoutMs?: number
  attempts?: number
  backoffMs?: number
  maxIdsPerRequest?: number
  sleep?: (milliseconds: number) => Promise<void>
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_ATTEMPTS = 3
const DEFAULT_BACKOFF_MS = 500
export const PUBLISHED_TOPIC_CHUNK_SIZE = 50
const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504])

function nestedErrorDetails(error: unknown): string {
  const values: string[] = []
  let current: unknown = error
  const visited = new Set<unknown>()

  for (let depth = 0; depth < 4 && current && !visited.has(current); depth++) {
    visited.add(current)
    const item = current as {
      name?: unknown
      message?: unknown
      code?: unknown
      address?: unknown
      port?: unknown
      cause?: unknown
    }
    const details = [
      typeof item.name === 'string' ? `name=${item.name}` : null,
      typeof item.message === 'string' ? `message=${item.message}` : null,
      typeof item.code === 'string' ? `code=${item.code}` : null,
      typeof item.address === 'string' ? `address=${item.address}` : null,
      typeof item.port === 'number' || typeof item.port === 'string' ? `port=${item.port}` : null,
    ].filter(Boolean)
    if (details.length > 0) values.push(details.join(', '))
    current = item.cause
  }

  return values.join(' <- ') || String(error)
}

function isRetryableNetworkError(error: unknown): boolean {
  let current: unknown = error
  let code: string | null = null
  for (let depth = 0; depth < 4 && current; depth++) {
    const item = current as { name?: unknown; code?: unknown; cause?: unknown }
    if (item.name === 'AbortError' || item.name === 'TimeoutError') return true
    if (typeof item.code === 'string') {
      code = item.code
      break
    }
    current = item.cause
  }
  return code === null || [
    'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT',
  ].includes(code)
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function fetchPublishedTopicRows(
  clusterIds: string[],
  supabaseUrl: string,
  serviceRoleKey: string,
  options: PublishedTopicQueryOptions = {},
): Promise<PublishedTopicRow[]> {
  if (clusterIds.length === 0) return []

  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS
  const maxIdsPerRequest = options.maxIdsPerRequest ?? PUBLISHED_TOPIC_CHUNK_SIZE
  const sleep = options.sleep ?? delay
  if (!Number.isInteger(maxIdsPerRequest) || maxIdsPerRequest < 1) {
    throw new Error('게시 완료 토픽 조회 maxIdsPerRequest는 양의 정수여야 합니다.')
  }

  const uniqueIds = Array.from(new Set(clusterIds))
  const chunks = Array.from(
    { length: Math.ceil(uniqueIds.length / maxIdsPerRequest) },
    (_, index) => uniqueIds.slice(index * maxIdsPerRequest, (index + 1) * maxIdsPerRequest),
  )
  const rows: PublishedTopicRow[] = []
  const seenRowIds = new Set<string>()

  for (const [chunkIndex, ids] of chunks.entries()) {
    const url = new URL('/rest/v1/article_clusters', supabaseUrl)
    url.searchParams.set('select', 'id,topic')
    url.searchParams.set('id', `in.(${ids.join(',')})`)
    const context = `host=${url.hostname} chunk=${chunkIndex + 1}/${chunks.length} ids=${ids.length}`
    let chunkRows: PublishedTopicRow[] | null = null

    for (let attempt = 1; attempt <= attempts; attempt++) {
      let response: Response
      try {
        response = await fetchImpl(url, {
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (error) {
        const wrapped = new Error(
          `Supabase REST 네트워크 오류 ${context} attempt=${attempt}/${attempts}: ${nestedErrorDetails(error)}`,
        )
        if (!isRetryableNetworkError(error) || attempt === attempts) throw wrapped
        await sleep(backoffMs * 2 ** (attempt - 1))
        continue
      }

      const body = await response.text()
      if (!response.ok) {
        const error = new Error(
          `Supabase REST HTTP ${response.status} ${context} body=${body.slice(0, 300)}`,
        )
        if (!RETRYABLE_HTTP_STATUSES.has(response.status) || attempt === attempts) throw error
        await sleep(backoffMs * 2 ** (attempt - 1))
        continue
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(body)
      } catch (error) {
        throw new Error(`Supabase REST JSON 오류 ${context}: ${nestedErrorDetails(error)}`)
      }
      if (!Array.isArray(parsed)) {
        throw new Error(`Supabase REST JSON 형식 오류 ${context}: 배열이 아닙니다.`)
      }
      chunkRows = parsed.map((row, index) => {
        const value = row as { id?: unknown; topic?: unknown }
        if (typeof value.id !== 'string' || (value.topic !== null && typeof value.topic !== 'string')) {
          throw new Error(`Supabase REST JSON 행 형식 오류 ${context} index=${index}`)
        }
        return { id: value.id, topic: value.topic }
      })
      break
    }

    if (!chunkRows) throw new Error(`Supabase REST 조회 실패 ${context}`)
    for (const row of chunkRows) {
      if (seenRowIds.has(row.id)) continue
      seenRowIds.add(row.id)
      rows.push(row)
    }
  }

  return rows
}

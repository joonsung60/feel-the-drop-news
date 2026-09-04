import http, { type IncomingHttpHeaders } from 'node:http'
import https from 'node:https'

type LongRunningRequestOptions = {
  method?: string
  headers?: HeadersInit
  body?: string
  timeoutMs: number
  label?: string
}

type ErrorWithCode = Error & {
  code?: unknown
  cause?: unknown
}

export class LongRunningRequestTimeoutError extends Error {
  readonly code = 'LONG_REQUEST_TIMEOUT'

  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`)
    this.name = 'TimeoutError'
  }
}

function responseHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers()
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item)
    } else if (value !== undefined) {
      result.set(name, value)
    }
  }
  return result
}

export function formatErrorWithCause(error: unknown): string {
  if (!(error instanceof Error)) return String(error)

  const parts: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error

  while (current instanceof Error && !seen.has(current)) {
    seen.add(current)
    const code = (current as ErrorWithCode).code
    parts.push(`${current.name}: ${current.message}${typeof code === 'string' ? ` [${code}]` : ''}`)
    current = (current as ErrorWithCode).cause
  }

  if (current !== undefined && current !== null && !seen.has(current)) {
    parts.push(String(current))
  }
  return parts.join(' <- ')
}

export function requestWithExplicitTimeout(
  urlValue: string | URL,
  options: LongRunningRequestOptions,
): Promise<Response> {
  const url = new URL(urlValue)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return Promise.reject(new Error(`지원하지 않는 HTTP protocol입니다: ${url.protocol}`))
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    return Promise.reject(new Error(`timeoutMs는 양의 정수여야 합니다: ${options.timeoutMs}`))
  }

  const transport = url.protocol === 'https:' ? https : http
  const label = options.label ?? `${options.method ?? 'GET'} ${url.origin}${url.pathname}`

  return new Promise<Response>((resolve, reject) => {
    let settled = false
    const request = transport.request(url, {
      method: options.method ?? 'GET',
      headers: Object.fromEntries(new Headers(options.headers).entries()),
    })

    const timer = setTimeout(() => {
      request.destroy(new LongRunningRequestTimeoutError(label, options.timeoutMs))
    }, options.timeoutMs)

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }

    request.once('error', (error) => finish(() => reject(error)))
    request.once('response', (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })
      response.once('error', (error) => finish(() => reject(error)))
      response.once('aborted', () => {
        const error = new Error(`${label} response was aborted`) as ErrorWithCode
        error.code = 'RESPONSE_ABORTED'
        finish(() => reject(error))
      })
      response.once('end', () => finish(() => resolve(new Response(
        new Uint8Array(Buffer.concat(chunks)),
        {
          status: response.statusCode ?? 500,
          statusText: response.statusMessage,
          headers: responseHeaders(response.headers),
        },
      ))))
    })

    if (options.body !== undefined) request.write(options.body)
    request.end()
  })
}

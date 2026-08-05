import { createHash, randomUUID } from 'node:crypto'

export function createIngestionRunId(): string {
  return randomUUID()
}

export function rssIngestionSource(sourceId: string | number): string {
  return `rss:${String(sourceId)}`
}

export function directUrlIngestionSource(): string {
  return 'direct_url'
}

export function correspondentIngestionSource(sourceUrl: string): string {
  const normalized = sourceUrl.trim().toLowerCase().replace(/\/+$/, '')
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 24)
  return `correspondent:${digest}`
}

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { hasExplicitEdmEvidence } from '../lib/suggest/eligibility'
import type { RawArticle } from '../lib/suggest/types'

const PAGE_SIZE = 1000
const EXCERPT_LIMIT = 800
const OUTPUT_PATH = path.join(
  process.cwd(),
  'research/suggest-fallback-sweep-2026-08-04.json',
)

const BASELINE_PATTERNS = [
  /\belectronic music\b/i,
  /\bdance music\b/i,
  /\bhouse music\b/i,
  /\b(?:techno|trance|dubstep|drum and bass|drum & bass|dnb)\b/i,
  /\bDJ\b/,
  /\belectronic(?:\s+music)?\s+producer\b/i,
  /전자\s*음악|일렉트로닉\s*뮤직|하우스\s*뮤직|테크노|트랜스|덥스텝|드럼\s*앤드\s*베이스|디제이/i,
  /電子音楽|エレクトロニック(?:・|\s*)ミュージック|ハウス(?:・|\s*)ミュージック|テクノ|トランス|ダブステップ|ドラム(?:・|\s*)アンド(?:・|\s*)ベース|DJ/i,
]

const TRIGGERS = {
  synth: /\bsynth\b/i,
  synthesizer: /\bsynthesizer\b/i,
  chiptune: /\bchiptune\b/i,
  dj: /\bDJ(?:s|ing)?\b/i,
}

type SweepArticle = RawArticle & {
  origin: string | null
  fetched_at: string | null
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} environment variable is required`)
  return value
}

function baselineEvidence(article: RawArticle): boolean {
  const text = `${article.title}\n${(article.content ?? '').slice(0, 500)}`
  return BASELINE_PATTERNS.some((pattern) => pattern.test(text))
}

function sanitized(article: SweepArticle) {
  const content = article.content ?? ''
  const haystack = `${article.title}\n${content.slice(0, 500)}`
  return {
    id: article.id,
    title: article.title,
    url: article.url,
    origin: article.origin,
    publishedAt: article.published_at ?? null,
    fetchedAt: article.fetched_at,
    triggers: Object.entries(TRIGGERS)
      .filter(([, pattern]) => pattern.test(haystack))
      .map(([name]) => name),
    excerpt: content.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_LIMIT),
    contentLength: content.length,
    contentHash: createHash('sha256').update(content).digest('hex'),
  }
}

async function main() {
  const supabase = createClient(
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const rows: SweepArticle[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('raw_articles')
      .select('id, title, content, url, source_id, published_at, facts, origin, fetched_at')
      .eq('origin', 'rss')
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`RSS sweep query failed: ${error.message}`)
    rows.push(...((data ?? []) as SweepArticle[]))
    if ((data?.length ?? 0) < PAGE_SIZE) break
  }

  const added = rows.filter((article) =>
    !baselineEvidence(article) && hasExplicitEdmEvidence(article)
  )
  const removed = rows.filter((article) =>
    baselineEvidence(article) && !hasExplicitEdmEvidence(article)
  )
  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    scope: { origin: 'rss', total: rows.length },
    baselineEligible: rows.filter(baselineEvidence).length,
    currentEligible: rows.filter(hasExplicitEdmEvidence).length,
    added: added.map(sanitized),
    removed: removed.map(sanitized),
  }
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`)
  console.log(JSON.stringify({
    output: OUTPUT_PATH,
    total: rows.length,
    baselineEligible: output.baselineEligible,
    currentEligible: output.currentEligible,
    added: output.added.length,
    removed: output.removed.length,
  }, null, 2))
}

main().catch((error) => {
  console.error(String(error))
  process.exitCode = 1
})

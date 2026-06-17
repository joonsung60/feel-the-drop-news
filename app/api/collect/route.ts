import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { extractArticleText, extractArticleTitle, extractImageUrl, isUrlLikeTitle, titleFromUrl } from '@/lib/article-extraction'
import Parser from 'rss-parser'

const parser = new Parser()
const RSS_TIMEOUT_MS = 12000
const REQUEST_HEADERS = {
  'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  'User-Agent': 'Mozilla/5.0 EDM Star News RSS Collector',
}

type RssSource = {
  id: string
  name: string
  url: string
}

type CollectFailure = {
  source: string
  url: string
  error: string
}

type RssDiagnostics = {
  sourceCount: number
  parsedSourceCount: number
  failedSourceCount: number
  totalFeedItems: number
  processedFeedItems: number
  insertedCount: number
  duplicateSkippedCount: number
  skippedNoLinkCount: number
  failedItemCount: number
}

type UrlDiagnostics = {
  urlCount: number
  insertedCount: number
  duplicateSkippedCount: number
  failedItemCount: number
}

function parsePublishedAt(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null
  }

  const normalized = value
    .replace(/\bBST\b/g, '+0100')
    .replace(/\bGMT\b/g, '+0000')
    .replace(/\bUTC\b/g, '+0000')
  const date = new Date(normalized)

  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

async function fetchFeed(url: string) {
  const res = await fetch(url, {
    headers: REQUEST_HEADERS,
    signal: AbortSignal.timeout(RSS_TIMEOUT_MS),
  })
  const text = await res.text()

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 120).replace(/\s+/g, ' ')}`)
  }

  return parser.parseString(text)
}

async function fetchArticleContent(url: string): Promise<{ content: string; imageUrl: string | null; title: string | null }> {
  try {
    const res = await fetch(url, { headers: REQUEST_HEADERS, signal: AbortSignal.timeout(10000) })
    const html = await res.text()

    const title = extractArticleTitle(html, url)
    const imageUrl = extractImageUrl(html)
    const content = extractArticleText(html, 20000)

    return { content, imageUrl, title }
  } catch {
    return { content: '', imageUrl: null, title: titleFromUrl(url) }
  }
}

// RSS 자동 수집
async function collectFromRSS(): Promise<{ collected: number; failures: CollectFailure[]; diagnostics: RssDiagnostics }> {
  const diagnostics: RssDiagnostics = {
    sourceCount: 0,
    parsedSourceCount: 0,
    failedSourceCount: 0,
    totalFeedItems: 0,
    processedFeedItems: 0,
    insertedCount: 0,
    duplicateSkippedCount: 0,
    skippedNoLinkCount: 0,
    failedItemCount: 0,
  }

  const { data: sources } = await supabase
    .from('rss_sources')
    .select('*')
    .eq('is_active', true)

  if (!sources) {
    console.log('소스 없음')
    return { collected: 0, failures: [], diagnostics }
  }

  diagnostics.sourceCount = sources.length
  console.log(`소스 ${sources.length}개 발견`)
  let collected = 0
  const failures: CollectFailure[] = []

  for (const source of sources as RssSource[]) {
    try {
      console.log(`파싱 시도: ${source.name} - ${source.url}`)
      const feed = await fetchFeed(source.url)
      diagnostics.parsedSourceCount++
      diagnostics.totalFeedItems += feed.items.length
      
      const itemsToProcess = feed.items.slice(0, 10)
      diagnostics.processedFeedItems += itemsToProcess.length
      console.log(`파싱 성공: ${source.name} - feed ${feed.items.length}개, 처리 ${itemsToProcess.length}개`)

      let sourceInserted = 0
      let sourceDuplicates = 0
      let sourceNoLink = 0

      for (const item of itemsToProcess) {
        if (!item.link) {
          diagnostics.skippedNoLinkCount++
          sourceNoLink++
          continue
        }

        const { data: existing } = await supabase
          .from('raw_articles')
          .select('id')
          .eq('url', item.link)
          .single()

        if (existing) {
          diagnostics.duplicateSkippedCount++
          sourceDuplicates++
          continue
        }

        const { content, imageUrl, title: extractedTitle } = await fetchArticleContent(item.link)
        const feedTitle = typeof item.title === 'string' ? item.title.trim() : ''
        const title = feedTitle && !isUrlLikeTitle(feedTitle)
          ? feedTitle
          : extractedTitle ?? titleFromUrl(item.link) ?? '제목 없음'

        const { error: insertError } = await supabase.from('raw_articles').insert({
          source_id: source.id,
          title,
          content,
          url: item.link,
          image_url: imageUrl,
          author: item.creator || null,
          published_at: parsePublishedAt(item.pubDate || item.isoDate),
        })

        if (insertError) {
          diagnostics.failedItemCount++
          failures.push({ source: source.name, url: item.link, error: String(insertError.message || insertError) })
          console.error(`Insert 실패: ${item.link}`, insertError)
        } else {
          diagnostics.insertedCount++
          sourceInserted++
          collected++
        }
      }

      console.log(`소스 완료: ${source.name} - 신규 ${sourceInserted}개, 중복 ${sourceDuplicates}개, 링크없음 ${sourceNoLink}개`)

      await supabase
        .from('rss_sources')
        .update({ last_fetched_at: new Date().toISOString() })
        .eq('id', source.id)

    } catch (err) {
      diagnostics.failedSourceCount++
      console.error(`RSS 실패: ${source.name}`, err)
      failures.push({ source: source.name, url: source.url, error: String(err) })
    }
  }

  return { collected, failures, diagnostics }
}

// URL 직접 추가
async function collectFromUrls(urls: string[]): Promise<{ collected: number; diagnostics: UrlDiagnostics }> {
  let collected = 0
  const diagnostics: UrlDiagnostics = {
    urlCount: urls.length,
    insertedCount: 0,
    duplicateSkippedCount: 0,
    failedItemCount: 0,
  }

  for (const url of urls) {
    try {
      const { data: existing } = await supabase
        .from('raw_articles')
        .select('id')
        .eq('url', url)
        .single()

      if (existing) {
        diagnostics.duplicateSkippedCount++
        continue
      }

      const { content, imageUrl, title } = await fetchArticleContent(url)

      const { error: insertError } = await supabase.from('raw_articles').insert({
        source_id: null,
        title: title ?? titleFromUrl(url) ?? '제목 없음',
        content,
        url,
        image_url: imageUrl,
        published_at: new Date().toISOString(),
      })

      if (insertError) {
        diagnostics.failedItemCount++
        console.error(`Insert 실패: ${url}`, insertError)
      } else {
        diagnostics.insertedCount++
        collected++
      }
    } catch (err) {
      diagnostics.failedItemCount++
      console.error(`URL 추가 실패: ${url}`, err)
    }
  }

  return { collected, diagnostics }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { urls } = body

    console.log('수집 시작:', urls ? `URL ${urls.length}개` : 'RSS 모드')

    let result;
    if (urls && urls.length > 0) {
      const { collected, diagnostics } = await collectFromUrls(urls)
      result = { collected, failures: [], diagnostics }
    } else {
      result = await collectFromRSS()
    }

    console.log('수집 완료:', result.collected)
    return NextResponse.json({ 
      success: true, 
      collected: result.collected, 
      failures: result.failures,
      diagnostics: result.diagnostics
    })
  } catch (err) {
    console.error('collect API 에러:', err)
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import {
  ALLOWED_STATUSES,
  DbSuggestedCluster,
  RawArticle,
  Suggestion,
  SuggestionStatus,
  SuggestionWithArticles,
} from '@/lib/suggest/types'
import { SUGGEST_RESPONSE_FORMAT, SUGGEST_SYSTEM, buildClusterPrompt } from '@/lib/suggest/prompts'
import { buildEntityIndex, loadEntityDictionary } from '@/lib/suggest/entity-index'
import { chunkArticles, normalizeSuggestion, parseSuggestions, articleSnippet } from '@/lib/suggest/normalize'
import { filterDuplicateSuggestions } from '@/lib/suggest/filters'
import { mergeNormalizedSuggestions } from '@/lib/suggest/merge'
import { rankAndTrim } from '@/lib/suggest/rank'
import { attachSourceMeta, hydrateSuggestions, markRawArticlesSuggested } from '@/lib/suggest/db'

const LLM_INPUT_MAX = 120
const NO_ENTITY_RATIO_MAX = 0.6
const LLM_BATCH_SIZE = 20

async function runLlmOnlyPath(
  rawArticles: RawArticle[],
  totalCount: number,
  suggestModel: string,
  ollamaUrl: string,
  validIds: Set<string>,
  articleMeta: Map<string, { id: string; title: string; url: string }>,
): Promise<NextResponse> {
  const articlesText = rawArticles
    .map((article) =>
      [
        `[${article.id}]`,
        article.sourceName ? `매체: ${article.sourceName}` : null,
        `제목: ${article.title}`,
        `요약: ${articleSnippet(article) || '(본문 없음)'}`,
      ].filter(Boolean).join('\n')
    )
    .join('\n---\n')

  const ollamaRes = await fetch(`${ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: suggestModel,
      system: SUGGEST_SYSTEM,
      prompt: `다음 기사 목록(${rawArticles.length}개)을 분석해 토픽 그룹을 제안하세요.\n\n${articlesText}`,
      format: SUGGEST_RESPONSE_FORMAT,
      stream: false,
    }),
  })

  if (!ollamaRes.ok) {
    return NextResponse.json({ error: `Ollama 응답 오류: ${ollamaRes.status}` }, { status: 502 })
  }

  const ollamaData = await ollamaRes.json()
  const responseText: string = ollamaData.response ?? ''

  let parsed: { suggestions?: Suggestion[] }
  try {
    parsed = parseSuggestions(responseText)
  } catch (err) {
    return NextResponse.json({ error: String(err), raw: responseText.slice(0, 500) }, { status: 502 })
  }

  const llmSuggestions = (parsed.suggestions ?? [])
    .map((suggestion) => normalizeSuggestion(suggestion, validIds, articleMeta, rawArticles))
    .filter((suggestion): suggestion is SuggestionWithArticles => suggestion !== null)

  if (llmSuggestions.length === 0) {
    return NextResponse.json({
      suggestions: [],
      saved: 0,
      total: totalCount,
      source: 'llm',
      model: suggestModel,
      llmSuggestionCount: parsed.suggestions?.length ?? 0,
      normalizedSuggestionCount: 0,
      rawResponsePreview: responseText.slice(0, 500),
    })
  }

  const { suggestions: saveableSuggestions, duplicateSkipCount } =
    await filterDuplicateSuggestions(llmSuggestions)

  if (saveableSuggestions.length === 0) {
    return NextResponse.json({
      suggestions: [],
      saved: 0,
      total: totalCount,
      source: 'llm',
      model: suggestModel,
      llmSuggestionCount: parsed.suggestions?.length ?? 0,
      normalizedSuggestionCount: llmSuggestions.length,
      duplicateSkipCount,
      rawResponsePreview: responseText.slice(0, 500),
    })
  }

  const insertPayload = saveableSuggestions.map((s) => ({
    topic: s.topic,
    keywords: s.keywords,
    article_ids: s.articleIds,
    status: 'pending' as const,
  }))

  const { data: inserted, error: insertError } = await supabase
    .from('suggested_clusters')
    .insert(insertPayload)
    .select()

  if (insertError) {
    return NextResponse.json({ error: `제안 저장 실패: ${insertError.message}` }, { status: 500 })
  }

  await markRawArticlesSuggested(saveableSuggestions)

  const persisted = await hydrateSuggestions((inserted ?? []) as DbSuggestedCluster[])
  return NextResponse.json({
    suggestions: persisted,
    saved: persisted.length,
    total: totalCount,
    source: 'llm',
    model: suggestModel,
    llmSuggestionCount: parsed.suggestions?.length ?? 0,
    normalizedSuggestionCount: llmSuggestions.length,
    duplicateSkipCount,
  })
}

export async function GET(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get('status')

    let query = supabase
      .from('suggested_clusters')
      .select('*')
      .order('created_at', { ascending: false })

    if (status) {
      if (!ALLOWED_STATUSES.includes(status as SuggestionStatus)) {
        return NextResponse.json(
          { error: `유효하지 않은 status: ${status}` },
          { status: 400 }
        )
      }
      query = query.eq('status', status)
    }

    const { data, error } = await query
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const suggestions = await hydrateSuggestions((data ?? []) as DbSuggestedCluster[])
    return NextResponse.json({ suggestions })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { limit: rawLimit } = body as { limit?: unknown }

    const MIN_LIMIT = 60
    const MAX_LIMIT = 200
    const BATCH_SIZE = 20

    const clampedLimit = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Number(rawLimit) || 100))
    const limit = Math.ceil(clampedLimit / BATCH_SIZE) * BATCH_SIZE

    const { data: articles, error } = await supabase
      .from('raw_articles')
      .select('id, title, content, url, source_id, published_at')
      .or('suggestion_state.is.null,suggestion_state.eq.new')
      .order('published_at', { ascending: false })
      .limit(limit)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!articles || articles.length === 0) {
      return NextResponse.json({ suggestions: [], total: 0, message: '최근 미사용 기사가 없습니다.' })
    }

    const rawArticles = await attachSourceMeta(articles as RawArticle[])
    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
    const suggestModel = process.env.OLLAMA_SUGGEST_MODEL || process.env.OLLAMA_MODEL || 'qwen3:14b'
    const validIds = new Set(rawArticles.map((a) => a.id))
    const articleMeta = new Map(
      rawArticles.map((a) => [a.id, { id: a.id, title: a.title, url: a.url }])
    )

    const dict = loadEntityDictionary()
    if (!dict) {
      console.error('[suggest-clusters] entity dictionary 로드 실패 — 단일 LLM 경로로 fallback')
      return await runLlmOnlyPath(rawArticles, articles.length, suggestModel, ollamaUrl, validIds, articleMeta)
    }

    // ───── Stage 1: 엔터티 매칭으로 LLM 투입 기사 필터링 ─────
    const { articleEntities } = buildEntityIndex(rawArticles, dict)
    const withEntities: RawArticle[] = []
    const withoutEntities: RawArticle[] = []
    for (const article of rawArticles) {
      const matched = articleEntities.get(article.id)
      if (matched && matched.size > 0) {
        withEntities.push(article)
      } else {
        withoutEntities.push(article)
      }
    }

    const prioritySelected = withEntities.slice(0, LLM_INPUT_MAX)
    const remainingSlots = LLM_INPUT_MAX - prioritySelected.length
    const noEntityMaxByRatio = Math.floor(LLM_INPUT_MAX * NO_ENTITY_RATIO_MAX)
    const noEntitySelected = withoutEntities.slice(0, Math.min(remainingSlots, noEntityMaxByRatio))
    const llmInput = [...prioritySelected, ...noEntitySelected]

    console.log(
      `[stage1] 전체 ${rawArticles.length}개 → 엔터티 매칭 ${withEntities.length}개`
      + ` / 미매칭 ${withoutEntities.length}개 → LLM 투입 ${llmInput.length}개`
    )

    if (llmInput.length === 0) {
      return NextResponse.json({
        suggestions: [],
        saved: 0,
        total: articles.length,
        source: 'filter+llm',
        model: suggestModel,
        entityMatchedCount: withEntities.length,
        noEntityCount: withoutEntities.length,
        llmInputCount: 0,
      })
    }

    // ───── Stage 2: LLM이 배치별 클러스터링 + 토픽 제안 ─────
    const batches = chunkArticles(llmInput, LLM_BATCH_SIZE)
    const normalized: SuggestionWithArticles[] = []
    let llmSuggestionCount = 0

    console.log(`[suggest-clusters] 배치 루프 시작: 총 ${batches.length}개 배치`)

    for (const [batchIndex, batch] of batches.entries()) {
      console.log(`[batch ${batchIndex}] 시작 (기사 ${batch.length}개)`)

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 180000)

      let ollamaRes: Response
      try {
        ollamaRes = await fetch(`${ollamaUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: suggestModel,
            options: { num_ctx: 16384 },
            system: SUGGEST_SYSTEM,
            prompt: buildClusterPrompt(batch),
            format: SUGGEST_RESPONSE_FORMAT,
            stream: false,
          }),
          signal: controller.signal,
        })
      } catch (err: unknown) {
        clearTimeout(timeoutId)
        if (err instanceof Error && err.name === 'AbortError') {
          console.log(`[batch ${batchIndex}] 타임아웃 - 건너뜀`)
        } else {
          console.error(`[batch ${batchIndex}] fetch 에러 - 건너뜀:`, String(err))
        }
        continue
      }
      clearTimeout(timeoutId)

      if (!ollamaRes.ok) {
        console.error(`[batch ${batchIndex}] Ollama 응답 오류: ${ollamaRes.status} - 건너뜀`)
        continue
      }

      const ollamaData = await ollamaRes.json()
      const responseText: string = ollamaData.response ?? ''
      console.log(`[batch ${batchIndex}] LLM response (first 300 chars): ${responseText.slice(0, 300)}`)

      let parsed: { suggestions?: Suggestion[] }
      try {
        parsed = parseSuggestions(responseText)
      } catch (err) {
        console.error(`[batch ${batchIndex}] parseSuggestions 에러 - 건너뜀:`, String(err))
        continue
      }

      const suggestions = parsed.suggestions ?? []
      llmSuggestionCount += suggestions.length
      
      normalized.push(
        ...suggestions
          .map((s) => normalizeSuggestion(s, validIds, articleMeta, rawArticles))
          .filter((s): s is SuggestionWithArticles => s !== null)
      )
      console.log(`[batch ${batchIndex}] 종료: ${suggestions.length}개 제안 파싱 완료`)
    }

    console.log(
      `[suggest-clusters] 배치 루프 종료, LLM 제안: ${llmSuggestionCount}건,`
      + ` 정규화 통과: ${normalized.length}건`
    )

    if (normalized.length === 0) {
      console.log('[suggest-clusters] 저장 0건')
      return NextResponse.json({
        suggestions: [],
        saved: 0,
        total: articles.length,
        source: 'filter+llm',
        model: suggestModel,
        entityMatchedCount: withEntities.length,
        noEntityCount: withoutEntities.length,
        llmInputCount: llmInput.length,
        batchCount: batches.length,
        llmSuggestionCount,
        normalizedSuggestionCount: 0,
      })
    }

    const merged = mergeNormalizedSuggestions(normalized, rawArticles)
    const ranked = rankAndTrim(merged, rawArticles, dict)
    const { suggestions: saveableSuggestions, duplicateSkipCount } =
      await filterDuplicateSuggestions(ranked)

    if (saveableSuggestions.length === 0) {
      console.log('[suggest-clusters] 저장 0건')
      return NextResponse.json({
        suggestions: [],
        saved: 0,
        total: articles.length,
        source: 'filter+llm',
        model: suggestModel,
        entityMatchedCount: withEntities.length,
        noEntityCount: withoutEntities.length,
        llmInputCount: llmInput.length,
        batchCount: batches.length,
        llmSuggestionCount,
        normalizedSuggestionCount: normalized.length,
        duplicateSkipCount,
      })
    }

    const insertPayload = saveableSuggestions.map((s) => ({
      topic: s.topic,
      keywords: s.keywords,
      article_ids: s.articleIds,
      status: 'pending' as const,
    }))

    const { data: inserted, error: insertError } = await supabase
      .from('suggested_clusters')
      .insert(insertPayload)
      .select()

    if (insertError) {
      return NextResponse.json({ error: `제안 저장 실패: ${insertError.message}` }, { status: 500 })
    }

    await markRawArticlesSuggested(saveableSuggestions)

    const persisted = await hydrateSuggestions((inserted ?? []) as DbSuggestedCluster[])
    console.log(`[suggest-clusters] 저장: ${persisted.length}건`)

    return NextResponse.json({
      suggestions: persisted,
      saved: persisted.length,
      total: articles.length,
      source: 'filter+llm',
      model: suggestModel,
      entityMatchedCount: withEntities.length,
      noEntityCount: withoutEntities.length,
      llmInputCount: llmInput.length,
      batchCount: batches.length,
      llmSuggestionCount,
      normalizedSuggestionCount: normalized.length,
      duplicateSkipCount,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get('status')

    if (status !== 'pending') {
      return NextResponse.json(
        { error: 'status=pending 파라미터가 필요하며, 다른 상태는 전체 삭제할 수 없습니다.' },
        { status: 400 }
      )
    }

    const { data: pendingRows, error: fetchError } = await supabase
      .from('suggested_clusters')
      .select('id, article_ids')
      .eq('status', 'pending')

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }

    const rawArticleIds = Array.from(new Set(
      ((pendingRows ?? []) as { article_ids: string[] | null }[])
        .flatMap((row) => row.article_ids ?? [])
    ))

    const { error } = await supabase
      .from('suggested_clusters')
      .delete()
      .eq('status', 'pending')

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    let rawArticleResetError: string | null = null
    if (rawArticleIds.length > 0) {
      const { error: rawUpdateError } = await supabase
        .from('raw_articles')
        .update({
          suggestion_state: 'new',
          suggestion_last_checked_at: null,
        })
        .in('id', rawArticleIds)

      if (rawUpdateError) {
        rawArticleResetError = rawUpdateError.message
        console.error('[suggest-clusters] pending 삭제 후 raw_articles 초기화 실패:', rawUpdateError.message)
      }
    }

    return NextResponse.json({
      success: true,
      deleted: pendingRows?.length ?? 0,
      resetRawArticles: rawArticleIds.length,
      rawArticleResetError,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

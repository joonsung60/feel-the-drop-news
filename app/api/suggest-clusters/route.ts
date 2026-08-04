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
import {
  chunkArticles,
  isSingletonRawSuggestion,
  normalizeSuggestion,
  parseSuggestions,
} from '@/lib/suggest/normalize'
import { hasEventDateConflict, knownEventDates } from '@/lib/suggest/event-date'
import { filterDuplicateSuggestions } from '@/lib/suggest/filters'
import { mergeNormalizedSuggestions } from '@/lib/suggest/merge'
import { rankAndTrim } from '@/lib/suggest/rank'
import {
  correspondentApprovalPath,
  partitionArticlesByEntityRole,
  selectEligibleLlmInput,
} from '@/lib/suggest/eligibility'
import { attachSourceMeta, hydrateSuggestions, markRawArticlesSuggested } from '@/lib/suggest/db'
import { PipelineObserver } from '@/lib/pipeline-observer'

const LLM_INPUT_MAX = 120
const NO_ENTITY_RATIO_MAX = 0.6
const LLM_BATCH_SIZE = 20

function suggestionDetail(suggestion: Partial<Suggestion>) {
  return {
    topic: suggestion.topic ?? null,
    article_ids: suggestion.articleIds ?? [],
    keywords: suggestion.keywords ?? [],
    common_entities: suggestion.commonEntities ?? [],
  }
}

function logSuggestionDropped(
  observer: PipelineObserver,
  suggestion: Partial<Suggestion>,
  reason: string,
  extra: Record<string, unknown> = {},
) {
  observer.event({
    stage: 'suggestion_dropped', reason, source: 'raw_articles', item_url: null,
    title: suggestion.topic ?? null, detail: { ...suggestionDetail(suggestion), ...extra },
  })
}

function finishRun(
  observer: PipelineObserver,
  response: NextResponse,
  detail: Record<string, unknown>,
  reason: 'ok' | 'error' = 'ok',
): NextResponse {
  observer.event({
    stage: 'run_end', reason, source: null, item_url: null, title: null, detail,
  })
  return response
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
  const observer = new PipelineObserver('suggest')
  try {
    const body = await req.json().catch(() => ({}))
    const { limit: rawLimit } = body as { limit?: unknown }

    const MIN_LIMIT = 60
    const MAX_LIMIT = 200
    const BATCH_SIZE = 20

    const clampedLimit = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Number(rawLimit) || 100))
    const limit = Math.ceil(clampedLimit / BATCH_SIZE) * BATCH_SIZE
    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
    const suggestModel = process.env.OLLAMA_SUGGEST_MODEL || process.env.OLLAMA_MODEL || 'qwen3:14b'

    observer.event({
      stage: 'run_start', reason: null, source: null, item_url: null, title: null,
      detail: {
        params: body,
        model: suggestModel,
        targets: ['raw_articles'],
        applied_limit: limit,
      },
    })

    const { data: articles, error } = await supabase
      .from('raw_articles')
      .select('id, title, content, url, source_id, published_at, event_date, facts')
      .or('suggestion_state.is.null,suggestion_state.eq.new')
      .order('published_at', { ascending: false })
      .limit(limit)

    if (error) {
      return finishRun(observer, NextResponse.json({ error: error.message }, { status: 500 }), {
        error: error.message,
      }, 'error')
    }
    const publishedValues = (articles ?? [])
      .map((article) => article.published_at)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .sort()
    observer.event({
      stage: 'pool_query', reason: 'ok', source: 'raw_articles', item_url: null, title: null,
      detail: {
        returned_rows: articles?.length ?? 0,
        applied_limit: limit,
        published_at_min: publishedValues[0] ?? null,
        published_at_max: publishedValues[publishedValues.length - 1] ?? null,
      },
    })
    if (!articles || articles.length === 0) {
      return finishRun(
        observer,
        NextResponse.json({ suggestions: [], total: 0, message: '최근 미사용 기사가 없습니다.' }),
        { total: 0, saved: 0 },
      )
    }

    const rawArticles = await attachSourceMeta(articles as RawArticle[])
    const articleMeta = new Map(
      rawArticles.map((a) => [a.id, { id: a.id, title: a.title, url: a.url }])
    )

    const dict = loadEntityDictionary()
    if (!dict) {
      throw new Error('entity dictionary unavailable; refusing unguarded LLM fallback')
    }

    // ───── Stage 1: 엔터티 매칭으로 LLM 투입 기사 필터링 ─────
    const {
      articleEntities,
      articleMentions,
      articleSupportingEntities,
      articleSupportingMentions,
    } = buildEntityIndex(rawArticles, dict)
    const partition = partitionArticlesByEntityRole(
      rawArticles,
      articleEntities,
      articleSupportingEntities,
    )
    for (const article of rawArticles) {
      const qualifying = articleEntities.get(article.id) ?? new Set()
      const supporting = articleSupportingEntities.get(article.id) ?? new Set()
      const reason = qualifying.size > 0
        ? 'qualifying'
        : supporting.size > 0 ? 'supporting_only' : 'not_matched'
      observer.event({
        stage: 'entity_match', reason,
        source: article.sourceName ?? null, item_url: article.url, title: article.title,
        detail: {
          article_id: article.id,
          qualifying: [...qualifying],
          supporting: [...supporting],
          mentioned: [...(articleMentions.get(article.id) ?? [])],
          supporting_mentioned: [...(articleSupportingMentions.get(article.id) ?? [])],
          approval_path: correspondentApprovalPath(article)
            ?? (qualifying.size > 0 ? 'entity' : 'none'),
        },
      })
    }

    const { input: llmInput, noEntitySelected } = selectEligibleLlmInput(
      partition,
      LLM_INPUT_MAX,
      NO_ENTITY_RATIO_MAX,
    )
    const prioritySelectedCount = Math.min(partition.qualifying.length, LLM_INPUT_MAX)
    for (const article of partition.qualifying.slice(prioritySelectedCount)) {
      observer.event({
        stage: 'llm_skipped', reason: 'entity_cap', source: article.sourceName ?? null,
        item_url: article.url, title: article.title, detail: { article_id: article.id },
      })
    }
    const selectedNoEntityIds = new Set(noEntitySelected.map((article) => article.id))
    for (const article of partition.notMatched.filter((item) => !selectedNoEntityIds.has(item.id))) {
      observer.event({
        stage: 'llm_skipped', reason: 'non_entity_cap', source: article.sourceName ?? null,
        item_url: article.url, title: article.title, detail: { article_id: article.id },
      })
    }
    for (const article of partition.supportingOnly) {
      observer.event({
        stage: 'llm_skipped', reason: 'supporting_entity_only',
        source: article.sourceName ?? null, item_url: article.url, title: article.title,
        detail: {
          article_id: article.id,
          supporting: [...(articleSupportingEntities.get(article.id) ?? [])],
          supporting_mentioned: [...(articleSupportingMentions.get(article.id) ?? [])],
        },
      })
    }
    for (const article of partition.danceExperience) {
      observer.event({
        stage: 'experience_gate', reason: 'accepted_dance_experience',
        source: article.sourceName ?? null, item_url: article.url, title: article.title,
        detail: {
          article_id: article.id,
          approval_path: 'dance_experience',
          candidate_key: article.facts?.correspondent_gate?.candidate_key ?? null,
        },
      })
    }

    console.log(
      `[stage1] 전체 ${rawArticles.length}개 → qualifying ${partition.qualifying.length}개`
      + ` / dance-experience ${partition.danceExperience.length}개`
      + ` / supporting-only ${partition.supportingOnly.length}개`
      + ` / 미매칭 ${partition.notMatched.length}개 → LLM 투입 ${llmInput.length}개`
    )

    if (llmInput.length === 0) {
      return finishRun(observer, NextResponse.json({
        suggestions: [],
        saved: 0,
        total: articles.length,
        source: 'filter+llm',
        model: suggestModel,
        entityMatchedCount: partition.qualifying.length,
        danceExperienceCount: partition.danceExperience.length,
        supportingOnlyCount: partition.supportingOnly.length,
        noEntityCount: partition.notMatched.length,
        llmInputCount: 0,
      }), { total: articles.length, saved: 0, llm_input_count: 0 })
    }

    // ───── Stage 2: LLM이 배치별 클러스터링 + 토픽 제안 ─────
    const batches = chunkArticles(llmInput, LLM_BATCH_SIZE)
    const normalized: SuggestionWithArticles[] = []
    let llmSuggestionCount = 0

    console.log(`[suggest-clusters] 배치 루프 시작: 총 ${batches.length}개 배치`)

    for (const [batchIndex, batch] of batches.entries()) {
      const batchValidIds = new Set(batch.map((article) => article.id))
      console.log(`[batch ${batchIndex}] 시작 (기사 ${batch.length}개)`)
      observer.event({
        stage: 'llm_input', reason: null, source: 'raw_articles', item_url: null, title: null,
        detail: {
          batch_index: batchIndex,
          article_ids: batch.map((article) => article.id),
          approval_paths: Object.fromEntries(
            batch.map((article) => [
              article.id,
              correspondentApprovalPath(article)
                ?? ((articleEntities.get(article.id)?.size ?? 0) > 0 ? 'entity' : 'legacy_fallback'),
            ]),
          ),
        },
      })

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
        logSuggestionDropped(observer, {}, err instanceof Error && err.name === 'AbortError' ? 'llm_timeout' : 'llm_fetch_error', {
          batch_index: batchIndex,
          article_ids: batch.map((article) => article.id),
          error: String(err),
        })
        continue
      }
      clearTimeout(timeoutId)

      if (!ollamaRes.ok) {
        console.error(`[batch ${batchIndex}] Ollama 응답 오류: ${ollamaRes.status} - 건너뜀`)
        logSuggestionDropped(observer, {}, 'llm_http_error', {
          batch_index: batchIndex, status_code: ollamaRes.status,
          article_ids: batch.map((article) => article.id),
        })
        continue
      }

      const ollamaData = await ollamaRes.json()
      const responseText: string = ollamaData.response ?? ''
      const rawPath = observer.saveRaw(responseText)
      console.log(`[batch ${batchIndex}] LLM response (first 300 chars): ${responseText.slice(0, 300)}`)

      let parsed: { suggestions?: Suggestion[] }
      try {
        parsed = parseSuggestions(responseText)
      } catch (err) {
        console.error(`[batch ${batchIndex}] parseSuggestions 에러 - 건너뜀:`, String(err))
        logSuggestionDropped(observer, {}, 'llm_parse_error', {
          batch_index: batchIndex, raw_path: rawPath, error: String(err),
        })
        continue
      }

      const suggestions = parsed.suggestions ?? []
      llmSuggestionCount += suggestions.length
      
      for (const suggestion of suggestions) {
        if (!isSingletonRawSuggestion(suggestion)) {
          logSuggestionDropped(observer, suggestion, 'raw_multi_article_not_allowed', {
            batch_index: batchIndex,
            raw_path: rawPath,
          })
          continue
        }
        const normalizedSuggestion = normalizeSuggestion(
          suggestion,
          batchValidIds,
          articleMeta,
          rawArticles,
          articleEntities,
        )
        if (normalizedSuggestion) normalized.push(normalizedSuggestion)
        else {
          const articleIds = (Array.isArray(suggestion.articleIds) ? suggestion.articleIds : [])
            .map((id) => String(id).trim())
            .filter((id) => batchValidIds.has(id))
          const requestedIds = (Array.isArray(suggestion.articleIds) ? suggestion.articleIds : [])
            .map((id) => String(id).trim())
          const containsIneligible = requestedIds.some((id) => !batchValidIds.has(id))
          const eventDates = knownEventDates(articleIds, rawArticles)
          logSuggestionDropped(
            observer,
            suggestion,
            containsIneligible
              ? 'article_not_edm_eligible'
              : hasEventDateConflict(articleIds, rawArticles)
                ? 'event_date_conflict'
                : 'normalization_failed',
            { batch_index: batchIndex, raw_path: rawPath, article_ids: articleIds, event_dates: eventDates },
          )
        }
      }
      console.log(`[batch ${batchIndex}] 종료: ${suggestions.length}개 제안 파싱 완료`)
    }

    console.log(
      `[suggest-clusters] 배치 루프 종료, LLM 제안: ${llmSuggestionCount}건,`
      + ` 정규화 통과: ${normalized.length}건`
    )

    if (normalized.length === 0) {
      console.log('[suggest-clusters] 저장 0건')
      return finishRun(observer, NextResponse.json({
        suggestions: [],
        saved: 0,
        total: articles.length,
        source: 'filter+llm',
        model: suggestModel,
        entityMatchedCount: partition.qualifying.length,
        danceExperienceCount: partition.danceExperience.length,
        supportingOnlyCount: partition.supportingOnly.length,
        noEntityCount: partition.notMatched.length,
        llmInputCount: llmInput.length,
        batchCount: batches.length,
        llmSuggestionCount,
        normalizedSuggestionCount: 0,
      }), { total: articles.length, saved: 0, llm_suggestion_count: llmSuggestionCount })
    }

    const merged = mergeNormalizedSuggestions(normalized, rawArticles)
    const mergedSet = new Set(merged)
    for (const suggestion of normalized) {
      if (!mergedSet.has(suggestion)) {
        logSuggestionDropped(observer, suggestion, 'merged_into_suggestion')
      }
    }
    const ranked = rankAndTrim(merged, rawArticles, dict)
    const rankedSet = new Set(ranked)
    for (const suggestion of merged) {
      if (!rankedSet.has(suggestion)) logSuggestionDropped(observer, suggestion, 'rank_cap')
    }
    const { suggestions: saveableSuggestions, duplicateSkipCount } =
      await filterDuplicateSuggestions(ranked, (suggestion, reason) => {
        logSuggestionDropped(observer, suggestion, reason)
      })

    if (saveableSuggestions.length === 0) {
      console.log('[suggest-clusters] 저장 0건')
      return finishRun(observer, NextResponse.json({
        suggestions: [],
        saved: 0,
        total: articles.length,
        source: 'filter+llm',
        model: suggestModel,
        entityMatchedCount: partition.qualifying.length,
        danceExperienceCount: partition.danceExperience.length,
        supportingOnlyCount: partition.supportingOnly.length,
        noEntityCount: partition.notMatched.length,
        llmInputCount: llmInput.length,
        batchCount: batches.length,
        llmSuggestionCount,
        normalizedSuggestionCount: normalized.length,
        duplicateSkipCount,
      }), { total: articles.length, saved: 0, duplicate_skip_count: duplicateSkipCount })
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
      for (const suggestion of saveableSuggestions) {
        logSuggestionDropped(observer, suggestion, 'insert_error', { error: insertError.message })
      }
      return finishRun(
        observer,
        NextResponse.json({ error: `제안 저장 실패: ${insertError.message}` }, { status: 500 }),
        { error: insertError.message },
        'error',
      )
    }

    await markRawArticlesSuggested(saveableSuggestions)

    const persisted = await hydrateSuggestions((inserted ?? []) as DbSuggestedCluster[])
    console.log(`[suggest-clusters] 저장: ${persisted.length}건`)

    for (const suggestion of persisted) {
      observer.event({
        stage: 'suggestion_saved', reason: 'ok', source: 'suggested_clusters', item_url: null,
        title: suggestion.topic, detail: { id: suggestion.id, article_ids: suggestion.articleIds },
      })
    }

    return finishRun(observer, NextResponse.json({
      suggestions: persisted,
      saved: persisted.length,
      total: articles.length,
      source: 'filter+llm',
      model: suggestModel,
      entityMatchedCount: partition.qualifying.length,
      danceExperienceCount: partition.danceExperience.length,
      supportingOnlyCount: partition.supportingOnly.length,
      noEntityCount: partition.notMatched.length,
      llmInputCount: llmInput.length,
      batchCount: batches.length,
      llmSuggestionCount,
      normalizedSuggestionCount: normalized.length,
      duplicateSkipCount,
    }), {
      total: articles.length,
      saved: persisted.length,
      llm_input_count: llmInput.length,
      llm_suggestion_count: llmSuggestionCount,
      normalized_suggestion_count: normalized.length,
      duplicate_skip_count: duplicateSkipCount,
    })
  } catch (err) {
    return finishRun(
      observer,
      NextResponse.json({ error: String(err) }, { status: 500 }),
      { error: String(err) },
      'error',
    )
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

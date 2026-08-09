import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { RawArticle, SuggestionWithArticles } from '@/lib/suggest/types'
import { buildEntityIndex, loadEntityDictionary, buildPairClusters } from '@/lib/suggest/entity-index'
import { normalizeSuggestion } from '@/lib/suggest/normalize'
import { filterDuplicateSuggestions } from '@/lib/suggest/filters'
import {
  attachSourceMeta,
  markRawArticlesSuggestedBySuggest2,
  markRawArticlesSuggest2Checked,
} from '@/lib/suggest/db'
import { buildSingleGroupPrompt } from '@/lib/suggest/prompts'
import {
  completedSuggest2ArticleIds,
  excludeCurrentFreshCohorts,
  orderSuggest2Groups,
  selectSuggest2EntityArticles,
} from '@/lib/suggest/backlog-selection'
import { parseSuggest2Decision } from '@/lib/suggest/suggest2-decision'

const SUGGEST2_SYSTEM = `당신은 전세계 전자음악 씬 전반을 다루는 에디터입니다.
주어진 기사들이 모두 "같은 사건/릴리즈/행사/인물에 대한 동일한 뉴스"를 다루는지 판단하세요.
서로 다른 사건을 다루거나 단순 언급만 된 기사가 섞여 있다면 approved: false를 반환하세요.
승인할 경우 (approved: true), 해당 사건을 가장 잘 나타내는 구체적인 한국어 topic과 3~6개의 영문 keywords를 반환하세요.
거절할 경우 그 이유를 reason에 작성하세요.`

const SUGGEST2_FORMAT = {
  type: 'object',
  properties: {
    approved: { type: 'boolean' },
    topic: { type: 'string' },
    keywords: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' }
  },
  required: ['approved', 'topic', 'keywords', 'reason']
}

const BACKLOG_PAGE_SIZE = 1000

async function fetchAllEligibleArticles(): Promise<RawArticle[]> {
  const rows: RawArticle[] = []
  for (let from = 0; ; from += BACKLOG_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('raw_articles')
      .select('id, title, content, url, source_id, published_at, fetched_at, event_date, origin, ingestion_run_id, ingestion_source, suggest2_last_checked_at')
      .or('suggestion_state.is.null,suggestion_state.eq.new')
      .order('published_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + BACKLOG_PAGE_SIZE - 1)
    if (error) {
      throw new Error(`raw_articles backlog 조회 실패: ${error.message}`)
    }
    const page = (data ?? []) as RawArticle[]
    rows.push(...page)
    if (page.length < BACKLOG_PAGE_SIZE) break
  }
  return rows
}

export async function POST() {
  const runBackground = async () => {
    try {
      console.log('[suggest-clusters/extended] 백그라운드 작업 시작')

      const articles = await fetchAllEligibleArticles()

      if (!articles || articles.length === 0) {
        console.log('[suggest-clusters/extended] 처리할 기사가 없습니다.')
        return
      }

      const eligibleArticles = await attachSourceMeta(articles as RawArticle[])
      const { backlog: rawArticles, excludedRunIds } =
        excludeCurrentFreshCohorts(eligibleArticles)
      console.log(
        `[suggest-clusters/extended] fresh cohort ${excludedRunIds.length}개 제외, backlog ${rawArticles.length}개`,
      )
      const dict = loadEntityDictionary()
      if (!dict) {
        console.error('[suggest-clusters/extended] entity dictionary 로드 실패')
        return
      }

      const { articleEntities, entityArticles } = buildEntityIndex(rawArticles, dict)

      // 그래프 기반 쌍 유사도 점수 산정 및 서브클러스터 생성
      const groups = buildPairClusters(rawArticles, articleEntities, entityArticles, dict, {
        entityArticleSelector: (items, limit) =>
          selectSuggest2EntityArticles(items, limit),
      })
      const topGroups = orderSuggest2Groups(groups, rawArticles).slice(0, 30)

      console.log(`[suggest-clusters/extended] 총 ${groups.length}개 후보 중 상위 ${topGroups.length}개 처리 시작`)

      const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
      const suggestModel = process.env.OLLAMA_SUGGEST_MODEL || process.env.OLLAMA_MODEL || 'qwen3:14b'
      const articleMeta = new Map(rawArticles.map((a) => [a.id, { id: a.id, title: a.title, url: a.url }]))
      const rawArticlesMap = new Map(rawArticles.map((a) => [a.id, a]))

      const normalized: SuggestionWithArticles[] = []
      const groupResults: Array<{
        articleIds: string[]
        outcome: 'approved' | 'rejected' | 'failed'
      }> = []
      let llmApprovedCount = 0

      for (const [index, group] of topGroups.entries()) {
        console.log(`[suggest-clusters/extended] 그룹 ${index + 1}/${topGroups.length} 처리 중 (엔터티: ${group.entity})`)
        const batch = group.articleIds.map(id => rawArticlesMap.get(id)).filter((a): a is RawArticle => Boolean(a))
        const groupValidIds = new Set(batch.map((article) => article.id))
        
        try {
          const ollamaRes = await fetch(`${ollamaUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: suggestModel,
              options: { num_ctx: 16384 },
              system: SUGGEST2_SYSTEM,
              prompt: buildSingleGroupPrompt(batch, group.entity),
              format: SUGGEST2_FORMAT,
              stream: false,
            }),
            signal: AbortSignal.timeout(180000),
          })

          if (!ollamaRes.ok) {
            console.error(`[suggest-clusters/extended] Ollama 응답 오류: ${ollamaRes.status}`)
            groupResults.push({ articleIds: group.articleIds, outcome: 'failed' })
            continue
          }

          const ollamaData = await ollamaRes.json()
          const decisionResult = parseSuggest2Decision(ollamaData.response ?? '')
          if (decisionResult.outcome === 'failed') {
            groupResults.push({ articleIds: group.articleIds, outcome: 'failed' })
            console.error(
              `[suggest-clusters/extended] LLM decision 오류: ${decisionResult.error}`,
            )
          } else if (decisionResult.outcome === 'approved') {
            groupResults.push({ articleIds: group.articleIds, outcome: 'approved' })
            llmApprovedCount++
            const { decision } = decisionResult
            const suggestion = {
              topic: decision.topic,
              keywords: decision.keywords,
              articleIds: group.articleIds,
              reason: decision.reason,
              commonEntities: [group.entity]
            }
            const norm = normalizeSuggestion(
              suggestion,
              groupValidIds,
              articleMeta,
              rawArticles,
              articleEntities,
            )
            if (norm) normalized.push(norm)
          } else {
            groupResults.push({ articleIds: group.articleIds, outcome: 'rejected' })
            console.log(`[suggest-clusters/extended] 거절됨: ${decisionResult.decision.reason}`)
          }
        } catch (err) {
          groupResults.push({ articleIds: group.articleIds, outcome: 'failed' })
          console.error(`[suggest-clusters/extended] LLM 처리 중 오류:`, err)
        }
      }

      await markRawArticlesSuggest2Checked(completedSuggest2ArticleIds(groupResults))

      console.log(`[suggest-clusters/extended] LLM 승인: ${llmApprovedCount}건, 정규화 통과: ${normalized.length}건`)

      if (normalized.length > 0) {
        const { suggestions: saveableSuggestions } = await filterDuplicateSuggestions(normalized)
        
        if (saveableSuggestions.length > 0) {
          const insertPayload = saveableSuggestions.map((s) => ({
            topic: s.topic,
            keywords: s.keywords,
            article_ids: s.articleIds,
            status: 'pending' as const,
          }))

          const { error: insertError } = await supabase
            .from('suggested_clusters')
            .insert(insertPayload)

          if (insertError) {
            console.error(`[suggest-clusters/extended] 제안 저장 실패:`, insertError.message)
          } else {
            await markRawArticlesSuggestedBySuggest2(saveableSuggestions)
            console.log(`[suggest-clusters/extended] 최종 저장: ${saveableSuggestions.length}건`)
          }
        }
      }

      console.log('[suggest-clusters/extended] 백그라운드 작업 완료')
    } catch (err) {
      console.error('[suggest-clusters/extended] 백그라운드 작업 치명적 오류:', err)
    }
  }

  // Fire and forget
  runBackground().catch(console.error)
  
  return NextResponse.json({ status: "started" })
}

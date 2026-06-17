import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { RawArticle, SuggestionWithArticles } from '@/lib/suggest/types'
import { buildEntityIndex, loadEntityDictionary, buildPairClusters } from '@/lib/suggest/entity-index'
import { articleSnippet, normalizeSuggestion } from '@/lib/suggest/normalize'
import { filterDuplicateSuggestions } from '@/lib/suggest/filters'
import { attachSourceMeta, markRawArticlesSuggested } from '@/lib/suggest/db'

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

function buildSingleGroupPrompt(batch: RawArticle[], entity: string): string {
  const articlesText = batch
    .map((article) =>
      [
        `[${article.id}]`,
        article.sourceName ? `매체: ${article.sourceName}` : null,
        `제목: ${article.title}`,
        `본문: ${articleSnippet(article) || '(본문 없음)'}`,
      ].filter(Boolean).join('\n')
    )
    .join('\n---\n')

  return `다음은 엔터티 "${entity}"(으)로 묶인 기사 목록(${batch.length}개)입니다.
이 기사들이 모두 정확히 동일한 단일 사건을 다루고 있는지 확인하세요.

기사 목록:
${articlesText}`
}

export async function POST(req: NextRequest) {
  const runBackground = async () => {
    try {
      console.log('[suggest-clusters/extended] 백그라운드 작업 시작')

      const { data: articles, error } = await supabase
        .from('raw_articles')
        .select('id, title, content, url, source_id, published_at')
        .or('suggestion_state.is.null,suggestion_state.eq.new')
        .order('published_at', { ascending: false })

      if (error || !articles || articles.length === 0) {
        console.log('[suggest-clusters/extended] 처리할 기사가 없습니다.')
        return
      }

      const rawArticles = await attachSourceMeta(articles as RawArticle[])
      const dict = loadEntityDictionary()
      if (!dict) {
        console.error('[suggest-clusters/extended] entity dictionary 로드 실패')
        return
      }

      const { articleEntities, entityArticles } = buildEntityIndex(rawArticles, dict)

      // 그래프 기반 쌍 유사도 점수 산정 및 서브클러스터 생성
      const groups = buildPairClusters(rawArticles, articleEntities, entityArticles, dict)

      groups.sort((a, b) => b.weightSum - a.weightSum)
      const topGroups = groups.slice(0, 30)

      console.log(`[suggest-clusters/extended] 총 ${groups.length}개 후보 중 상위 ${topGroups.length}개 처리 시작`)

      const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
      const suggestModel = process.env.OLLAMA_SUGGEST_MODEL || process.env.OLLAMA_MODEL || 'qwen3:14b'
      const validIds = new Set(rawArticles.map((a) => a.id))
      const articleMeta = new Map(rawArticles.map((a) => [a.id, { id: a.id, title: a.title, url: a.url }]))
      const rawArticlesMap = new Map(rawArticles.map((a) => [a.id, a]))

      const normalized: SuggestionWithArticles[] = []
      let llmApprovedCount = 0

      for (const [index, group] of topGroups.entries()) {
        console.log(`[suggest-clusters/extended] 그룹 ${index + 1}/${topGroups.length} 처리 중 (엔터티: ${group.entity})`)
        const batch = group.articleIds.map(id => rawArticlesMap.get(id)).filter((a): a is RawArticle => Boolean(a))
        
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
            })
          })

          if (!ollamaRes.ok) {
            console.error(`[suggest-clusters/extended] Ollama 응답 오류: ${ollamaRes.status}`)
            continue
          }

          const ollamaData = await ollamaRes.json()
          const responseText: string = ollamaData.response ?? ''
          
          let parsed: Record<string, unknown> = {}
          try {
            parsed = JSON.parse(responseText)
          } catch {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/)
            if (jsonMatch) parsed = JSON.parse(jsonMatch[0])
            else continue
          }

          if (parsed.approved === true && typeof parsed.topic === 'string') {
            llmApprovedCount++
            const suggestion = {
              topic: parsed.topic,
              keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String) : [],
              articleIds: group.articleIds,
              reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
              commonEntities: [group.entity]
            }
            const norm = normalizeSuggestion(suggestion, validIds, articleMeta, rawArticles)
            if (norm) normalized.push(norm)
          } else {
            console.log(`[suggest-clusters/extended] 거절됨: ${parsed.reason}`)
          }
        } catch (err) {
          console.error(`[suggest-clusters/extended] LLM 처리 중 오류:`, err)
        }
      }

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
            await markRawArticlesSuggested(saveableSuggestions)
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

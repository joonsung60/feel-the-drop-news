import type { GroundingResult } from './article-grounding'

export type PublishOrchestrationResult<T> =
  | { type: 'success'; status: 200; article: T }
  | { type: 'grounding_failed'; status: 409; code: 'ARTICLE_GROUNDING_FAILED'; grounding: GroundingResult }
  | { type: 'article_changed'; status: 409; code: 'ARTICLE_CHANGED_DURING_PUBLISH' }
  | { type: 'article_update_failed'; error: string }
  | { type: 'raw_article_update_failed'; article: T; error: string }

export async function orchestrateArticlePublish<T>(input: {
  clusterId: string | null
  validateGrounding: () => Promise<GroundingResult>
  publishArticle: () => Promise<{ article: T | null; error: string | null }>
  markRawArticlesUsed: () => Promise<string | null>
  triggerDeploy: () => Promise<unknown>
}): Promise<PublishOrchestrationResult<T>> {
  if (input.clusterId) {
    const grounding = await input.validateGrounding()
    if (!grounding.ok) {
      return { type: 'grounding_failed', status: 409, code: 'ARTICLE_GROUNDING_FAILED', grounding }
    }
  }

  const published = await input.publishArticle()
  if (published.error) return { type: 'article_update_failed', error: published.error }
  if (!published.article) {
    return { type: 'article_changed', status: 409, code: 'ARTICLE_CHANGED_DURING_PUBLISH' }
  }

  if (input.clusterId) {
    const rawArticleError = await input.markRawArticlesUsed()
    if (rawArticleError) {
      return {
        type: 'raw_article_update_failed',
        article: published.article,
        error: rawArticleError,
      }
    }
  }

  await input.triggerDeploy()
  return { type: 'success', status: 200, article: published.article }
}

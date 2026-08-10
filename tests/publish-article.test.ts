import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error The test runner loads the TypeScript source directly.
import { orchestrateArticlePublish } from '../lib/publish-article.ts'

const failedGrounding = {
  ok: false,
  issues: [{
    code: 'UNSUPPORTED_ENTITY' as const,
    message: 'unsupported',
    entity: null,
    sourceEvidence: null,
  }],
}

test('grounding failure returns 409 before every publish mutation', async () => {
  let articleUpdates = 0
  let rawUpdates = 0
  let deploys = 0
  const result = await orchestrateArticlePublish({
    clusterId: 'cluster-1',
    validateGrounding: async () => failedGrounding,
    publishArticle: async () => { articleUpdates++; return { article: { id: 'article-1' }, error: null } },
    markRawArticlesUsed: async () => { rawUpdates++; return null },
    triggerDeploy: async () => { deploys++ },
  })

  assert.equal(result.type, 'grounding_failed')
  assert.equal(result.status, 409)
  assert.equal(result.code, 'ARTICLE_GROUNDING_FAILED')
  assert.equal(articleUpdates, 0)
  assert.equal(rawUpdates, 0)
  assert.equal(deploys, 0)
})

test('successful cluster publish mutates article, then raw articles, then deploys', async () => {
  const calls: string[] = []
  const result = await orchestrateArticlePublish({
    clusterId: 'cluster-1',
    validateGrounding: async () => { calls.push('validate'); return { ok: true, issues: [] } },
    publishArticle: async () => { calls.push('article'); return { article: { id: 'article-1' }, error: null } },
    markRawArticlesUsed: async () => { calls.push('raw'); return null },
    triggerDeploy: async () => { calls.push('deploy') },
  })

  assert.equal(result.type, 'success')
  assert.deepEqual(calls, ['validate', 'article', 'raw', 'deploy'])
})

test('optimistic-lock conflict returns 409 without raw mutation or deploy', async () => {
  let rawUpdates = 0
  let deploys = 0
  const result = await orchestrateArticlePublish({
    clusterId: 'cluster-1',
    validateGrounding: async () => ({ ok: true, issues: [] }),
    publishArticle: async () => ({ article: null, error: null }),
    markRawArticlesUsed: async () => { rawUpdates++; return null },
    triggerDeploy: async () => { deploys++ },
  })

  assert.equal(result.type, 'article_changed')
  assert.equal(result.status, 409)
  assert.equal(result.code, 'ARTICLE_CHANGED_DURING_PUBLISH')
  assert.equal(rawUpdates, 0)
  assert.equal(deploys, 0)
})

test('non-cluster publishing preserves article update then deploy flow', async () => {
  const calls: string[] = []
  const result = await orchestrateArticlePublish({
    clusterId: null,
    validateGrounding: async () => { calls.push('validate'); return failedGrounding },
    publishArticle: async () => { calls.push('article'); return { article: { id: 'article-1' }, error: null } },
    markRawArticlesUsed: async () => { calls.push('raw'); return null },
    triggerDeploy: async () => { calls.push('deploy') },
  })

  assert.equal(result.type, 'success')
  assert.deepEqual(calls, ['article', 'deploy'])
})

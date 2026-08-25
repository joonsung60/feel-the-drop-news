import assert from 'node:assert/strict'
import test from 'node:test'
import { completeArticleUnpublish } from '../lib/article-unpublish'
import type { DeployHookResult } from '../lib/deploy-hook'

for (const deploy of [
  { success: true },
  { success: false, cooldown: true },
  { success: false, error: 'HTTP 503' },
] satisfies DeployHookResult[]) {
  test(`unpublish 성공은 deploy 결과 ${JSON.stringify(deploy)}를 보존하고 hook을 한 번 호출한다`, async () => {
    let deploys = 0
    const result = await completeArticleUnpublish({
      updateArticle: async () => ({ data: { id: 'article-1', published: false }, error: null }),
      triggerDeploy: async () => { deploys++; return deploy },
    })

    assert.equal(deploys, 1)
    assert.deepEqual(result, {
      article: { id: 'article-1', published: false },
      error: null,
      deploy,
    })
  })
}

test('article DB update 실패는 기존 오류를 보존하고 deploy hook을 호출하지 않는다', async () => {
  let deploys = 0
  const result = await completeArticleUnpublish({
    updateArticle: async () => ({ data: null, error: { message: 'DB update failed' } }),
    triggerDeploy: async () => { deploys++; return { success: true } },
  })

  assert.equal(deploys, 0)
  assert.deepEqual(result, { article: null, error: 'DB update failed', deploy: null })
})


import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyHeroMutation,
  heroMutationError,
  isValidArticleId,
  resolveHeroUnpublishOutcome,
  toHeroDeployState,
} from '../lib/homepage-hero-mutation'

const updated = {
  result: 'updated' as const,
  articleId: '11111111-1111-4111-8111-111111111111',
  changed: true,
  updatedAt: '2026-08-25T00:00:00Z',
}

test('실질적 pin 변경은 deploy를 정확히 한 번 호출한다', async () => {
  let deploys = 0
  const result = await applyHeroMutation(updated.articleId, {
    setHero: async () => updated,
    triggerDeploy: async () => { deploys++; return { success: true } },
  })
  assert.equal(deploys, 1)
  assert.equal(result.deploy.status, 'triggered')
})

test('같은 pin과 반복 unpin은 deploy를 호출하지 않는다', async () => {
  let deploys = 0
  const result = await applyHeroMutation(null, {
    setHero: async () => ({ ...updated, result: 'unchanged', articleId: null, changed: false }),
    triggerDeploy: async () => { deploys++; return { success: true } },
  })
  assert.equal(deploys, 0)
  assert.equal(result.deploy.status, 'not_required')
})

test('cooldown과 실패는 DB 성공과 분리된 deploy 상태다', () => {
  assert.equal(toHeroDeployState({ success: false, cooldown: true }).status, 'cooldown')
  const failed = toHeroDeployState({ success: false, error: 'HTTP 503' })
  assert.equal(failed.status, 'failed')
  if (failed.status === 'failed') assert.equal(failed.error, 'HTTP 503')
})

test('article ID와 mutation 오류를 API 계약에 맞게 분류한다', () => {
  assert.equal(isValidArticleId('11111111-1111-4111-8111-111111111111'), true)
  assert.equal(isValidArticleId('not-an-id'), false)
  assert.deepEqual(heroMutationError('article_not_found'), {
    status: 404,
    error: '기사를 찾을 수 없습니다.',
  })
  assert.equal(heroMutationError('updated'), null)
})

test('pinned Hero unpublish의 triggered/cooldown/failed를 자동 해제 UX로 변환한다', () => {
  const triggered = resolveHeroUnpublishOutcome(true, { success: true }, null)
  assert.equal(triggered.reloadHero, true)
  assert.equal(triggered.deploy?.status, 'triggered')
  if (triggered.deploy?.status === 'triggered') {
    assert.match(triggered.deploy.message, /Hero 자동 해제/)
  }

  const cooldown = resolveHeroUnpublishOutcome(
    true,
    { success: false, cooldown: true },
    null
  )
  assert.equal(cooldown.reloadHero, true)
  assert.equal(cooldown.deploy?.status, 'cooldown')
  if (cooldown.deploy?.status === 'cooldown') {
    assert.match(cooldown.deploy.warning, /Hero 자동 해제/)
  }

  const failed = resolveHeroUnpublishOutcome(
    true,
    { success: false, error: 'HTTP 503' },
    null
  )
  assert.equal(failed.reloadHero, true)
  assert.equal(failed.deploy?.status, 'failed')
  if (failed.deploy?.status === 'failed') {
    assert.match(failed.deploy.warning, /Hero 자동 해제/)
    assert.equal(failed.deploy.error, 'HTTP 503')
  }
})

test('일반 기사 unpublish는 기존 Hero deploy 경고를 보존하고 Hero를 reload하지 않는다', () => {
  const current = toHeroDeployState({ success: false, cooldown: true })
  const outcome = resolveHeroUnpublishOutcome(false, { success: true }, current)
  assert.equal(outcome.reloadHero, false)
  assert.equal(outcome.deploy, current)
})

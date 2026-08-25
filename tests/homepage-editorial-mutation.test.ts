import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyEditorialMutation,
  resolveHomepageUnpublishOutcome,
  toHomepageDeployState,
} from '../lib/homepage-editorial-mutation'

test('changed Feature+placement mutation은 deploy를 정확히 한 번 호출한다', async () => {
  let deploys = 0
  const result = await applyEditorialMutation(
    async () => ({ result: 'updated', articleId: 'a', placement: 'homepage_featured_1', changed: true }),
    async () => { deploys += 1; return { success: false, cooldown: true } }
  )
  assert.equal(deploys, 1)
  assert.equal(result.deploy.status, 'cooldown')
  assert.equal(result.mutation.changed, true)
})

test('no-op mutation은 deploy를 호출하지 않는다', async () => {
  let deploys = 0
  const result = await applyEditorialMutation(
    async () => ({ result: 'unchanged', articleId: 'a', changed: false }),
    async () => { deploys += 1; return { success: true } }
  )
  assert.equal(deploys, 0)
  assert.equal(result.deploy.status, 'not_required')
})

test('pinned Hero unpublish는 Hero 전용 결과와 두 상태 reload를 유지한다', () => {
  for (const result of [
    { success: true },
    { success: false, cooldown: true },
    { success: false, error: 'HTTP 503' },
  ]) {
    const outcome = resolveHomepageUnpublishOutcome(
      { wasPinnedHero: true, wasFeature: true },
      result,
      null
    )
    assert.equal(outcome.reloadHero, true)
    assert.equal(outcome.reloadEditorial, true)
    const message = outcome.deploy?.status === 'triggered'
      ? outcome.deploy.message
      : outcome.deploy?.status === 'cooldown' || outcome.deploy?.status === 'failed'
        ? outcome.deploy.warning
        : ''
    assert.match(message, /Hero 자동 해제/)
  }
})

test('자동 Featured와 아카이브 전용 Feature unpublish는 홈페이지 deploy 결과와 Editorial reload를 사용한다', () => {
  for (const result of [
    { success: true },
    { success: false, cooldown: true },
    { success: false, error: 'HTTP 503' },
  ]) {
    const outcome = resolveHomepageUnpublishOutcome(
      { wasPinnedHero: false, wasFeature: true },
      result,
      null
    )
    assert.equal(outcome.deploy?.status, toHomepageDeployState(result).status)
    assert.equal(outcome.reloadHero, false)
    assert.equal(outcome.reloadEditorial, true)
  }
})

test('일반 기사 unpublish는 기존 홈페이지 경고를 보존하고 상태를 reload하지 않는다', () => {
  const current = toHomepageDeployState({ success: false, cooldown: true })
  const outcome = resolveHomepageUnpublishOutcome(
    { wasPinnedHero: false, wasFeature: false },
    { success: true },
    current
  )
  assert.equal(outcome.deploy, current)
  assert.equal(outcome.reloadHero, false)
  assert.equal(outcome.reloadEditorial, false)
})

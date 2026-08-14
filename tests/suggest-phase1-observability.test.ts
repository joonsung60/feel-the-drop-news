import assert from 'node:assert/strict'
import test from 'node:test'
import {
  findUnmentionedArticleIds,
  isLowSignalClusterText,
  isUrlOrDomainText,
  normalizeSuggestionDetailed,
} from '../lib/suggest/normalize'
import {
  ArticleEntityPartition,
  selectEligibleLlmInput,
} from '../lib/suggest/eligibility'
import { RawArticle } from '../lib/suggest/types'

function article(id: string, title: string, content = ''): RawArticle {
  return {
    id,
    title,
    content,
    url: `https://source.invalid/${id}`,
    source_id: null,
    origin: 'rss',
  }
}

test('standalone country, language, and artist tokens are not treated as domains', () => {
  for (const value of [
    'UK',
    'de',
    'FM',
    '¥ØU$UK€',
    'Charlotte de Witte',
    'Korg Opsix FM Synthesizer',
  ]) {
    assert.equal(isUrlOrDomainText(value), false, value)
  }
})

test('real URL and hostname syntax remains blocked', () => {
  for (const value of [
    'example.co.uk',
    'https://example.de/path',
    'www.example.fm',
    'Read this at example.com/news',
  ]) {
    assert.equal(isUrlOrDomainText(value), true, value)
  }
})

test('Korean topics pass while year-only topics remain low signal', () => {
  assert.equal(isLowSignalClusterText('샬럿 드 비테 새 캠페인 참여'), false)
  assert.equal(isLowSignalClusterText('2027'), true)
})

test('normalization reports the exact failed predicate without changing the legacy API', () => {
  const raw = article('one', 'Charlotte de Witte announces a techno residency')
  const meta = new Map([[raw.id, { id: raw.id, title: raw.title, url: raw.url }]])
  const qualifying = new Map([[raw.id, new Set(['Charlotte de Witte'])]])

  const accepted = normalizeSuggestionDetailed({
    topic: 'Charlotte de Witte, 새 테크노 리지던시 발표',
    keywords: ['Charlotte de Witte'],
    commonEntities: ['Charlotte de Witte'],
    articleIds: [raw.id],
  }, new Set([raw.id]), meta, [raw], qualifying)
  assert.ok(accepted.suggestion)
  assert.equal(accepted.failureReason, null)

  const domain = normalizeSuggestionDetailed({
    topic: 'https://example.de/path',
    keywords: ['Charlotte de Witte'],
    articleIds: [raw.id],
  }, new Set([raw.id]), meta, [raw], qualifying)
  assert.equal(domain.failureReason, 'url_or_domain_text')

  const lowSignal = normalizeSuggestionDetailed({
    topic: '2027',
    keywords: ['Charlotte de Witte'],
    articleIds: [raw.id],
  }, new Set([raw.id]), meta, [raw], qualifying)
  assert.equal(lowSignal.failureReason, 'low_signal_topic')

  const shifted = normalizeSuggestionDetailed({
    topic: '다른 아티스트의 새 앨범',
    keywords: ['Unrelated Artist'],
    articleIds: [raw.id],
  }, new Set([raw.id]), meta, [raw], qualifying)
  assert.equal(shifted.failureReason, 'singleton_grounding_failed')
})

test('explicit evidence failures and true no-entity cap exclusions are separated', () => {
  const failed = article('failed', 'General culture report', 'No dance coverage here.')
  const selected = article('selected', 'Independent techno producer announces a set')
  const capped = article('capped', 'Electronic music producer releases a techno EP')
  const partition: ArticleEntityPartition = {
    qualifying: [],
    danceExperience: [],
    supportingOnly: [],
    notMatched: [failed, selected, capped],
  }

  const result = selectEligibleLlmInput(partition, 1, 1)
  assert.deepEqual(result.noEntitySelected.map(({ id }) => id), ['selected'])
  assert.deepEqual(result.explicitEvidenceFailed.map(({ id }) => id), ['failed'])
  assert.deepEqual(result.noEntityCapped.map(({ id }) => id), ['capped'])
})

test('LLM input IDs absent from every raw suggestion are observable', () => {
  assert.deepEqual(findUnmentionedArticleIds(['a', 'b', 'c'], [
    { articleIds: ['a'] },
    { articleIds: ['c', 'outside-batch'] },
  ]), ['b'])
})

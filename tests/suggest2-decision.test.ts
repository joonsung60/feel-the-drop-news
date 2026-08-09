import assert from 'node:assert/strict'
import test from 'node:test'
import { completedSuggest2ArticleIds } from '../lib/suggest/backlog-selection'
import { parseSuggest2Decision } from '../lib/suggest/suggest2-decision'

const valid = {
  approved: true,
  topic: '유효한 토픽',
  keywords: ['one', 'two'],
  reason: '',
}

function assertFailed(value: unknown) {
  const result = parseSuggest2Decision(JSON.stringify(value))
  assert.equal(result.outcome, 'failed')
  assert.deepEqual(completedSuggest2ArticleIds([
    { articleIds: ['article'], outcome: result.outcome },
  ]), [])
}

function without(value: Record<string, unknown>, key: string) {
  const copy = { ...value }
  delete copy[key]
  return copy
}

test('decision schema rejects missing approved', () => {
  assertFailed(without(valid, 'approved'))
})

test('decision schema rejects missing, empty, or non-string approved topic', () => {
  assertFailed(without(valid, 'topic'))
  assertFailed({ ...valid, topic: '  ' })
  assertFailed({ ...valid, topic: 42 })
})

test('decision schema rejects missing, object, or non-string keyword entries', () => {
  assertFailed(without(valid, 'keywords'))
  assertFailed({ ...valid, keywords: { one: true } })
  assertFailed({ ...valid, keywords: ['one', 2] })
})

test('decision schema rejects missing or non-string rejected reason', () => {
  const rejected = { ...valid, approved: false, topic: '' }
  assertFailed(without(rejected, 'reason'))
  assertFailed({ ...rejected, reason: 42 })
  assertFailed({ ...rejected, reason: '  ' })
})

test('valid approve and reject are the only checked outcomes', () => {
  const approved = parseSuggest2Decision(JSON.stringify(valid))
  const rejected = parseSuggest2Decision(JSON.stringify({
    ...valid, approved: false, topic: '', reason: '다른 사건',
  }))
  assert.equal(approved.outcome, 'approved')
  assert.equal(rejected.outcome, 'rejected')
  assert.deepEqual(completedSuggest2ArticleIds([
    { articleIds: ['approved'], outcome: approved.outcome },
    { articleIds: ['rejected'], outcome: rejected.outcome },
  ]), ['approved', 'rejected'])
})

test('invalid JSON is failed and not checked', () => {
  const result = parseSuggest2Decision('{invalid')
  assert.equal(result.outcome, 'failed')
  assert.deepEqual(completedSuggest2ArticleIds([
    { articleIds: ['invalid'], outcome: result.outcome },
  ]), [])
})

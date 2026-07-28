import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
// @ts-expect-error Node's TypeScript test runner requires the source extension at runtime.
import { applyDisplayNameMappingToTitle, applyKoreanAvoidCorrections, getEstablishedEntityDisplayNames } from '../lib/jobs/entity-display-name.ts'

type DictionaryEntry = {
  id: string
  en: string
  ko: string | null
  ko_status: string
  ko_avoid: string[]
}

type Dictionary = {
  counts: {
    ko_established: number
  }
  entities: DictionaryEntry[]
}

const dictionary = JSON.parse(
  readFileSync(new URL('../lib/edm-entities-v2.json', import.meta.url), 'utf8')
) as Dictionary
const displayNames = getEstablishedEntityDisplayNames(dictionary.entities)
const carlCox = dictionary.entities.find(({ id }) => id === 'artist_carl_cox')

test('Carl Cox is an established Korean entity and dictionary count is accurate', () => {
  assert.ok(carlCox)
  assert.equal(carlCox.ko, '칼 콕스')
  assert.equal(carlCox.ko_status, 'established')
  assert.ok(carlCox.ko_avoid.includes('칼빈 콕스'))
  assert.equal(
    dictionary.counts.ko_established,
    dictionary.entities.filter(({ ko_status }) => ko_status === 'established').length
  )
})

test('title mapping replaces Carl Cox English and avoided Korean names', () => {
  assert.equal(
    applyDisplayNameMappingToTitle('Carl Cox and David Guetta', displayNames),
    '칼 콕스 and 데이비드 게타'
  )
  const corrected = applyDisplayNameMappingToTitle('칼빈 콕스와 David Guetta', displayNames)
  assert.equal(corrected, '칼 콕스와 데이비드 게타')
  assert.equal(corrected.includes('칼빈 콕스'), false)
})

test('body correction fixes avoided names without replacing English names', () => {
  assert.equal(
    applyKoreanAvoidCorrections('칼빈 콕스가 공연한다.', displayNames),
    '칼 콕스가 공연한다.'
  )
  assert.equal(
    applyKoreanAvoidCorrections('칼빈 콕스(Carl Cox)가 공연한다.', displayNames),
    '칼 콕스(Carl Cox)가 공연한다.'
  )
  assert.equal(
    applyKoreanAvoidCorrections('칼 콕스(Carl Cox)가 공연한다.', displayNames),
    '칼 콕스(Carl Cox)가 공연한다.'
  )
  assert.equal(
    applyKoreanAvoidCorrections('Carl Cox가 공연한다.', displayNames),
    'Carl Cox가 공연한다.'
  )
  assert.equal(
    applyKoreanAvoidCorrections('칼 콕스(Carl Cox)가 공연한다.', displayNames)
      .includes('칼 콕스(칼 콕스)'),
    false
  )
})

test('body correction remains idempotent and handles other established ko_avoid values', () => {
  const once = applyKoreanAvoidCorrections('칼빈 콕스와 데이빗 게타가 공연한다.', displayNames)
  assert.equal(once, '칼 콕스와 데이비드 게타가 공연한다.')
  assert.equal(applyKoreanAvoidCorrections(once, displayNames), once)
})

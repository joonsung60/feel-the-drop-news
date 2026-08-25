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
    total: number
    ko_established: number
  }
  entities: DictionaryEntry[]
}

const dictionary = JSON.parse(
  readFileSync(new URL('../lib/edm-entities-v2.json', import.meta.url), 'utf8')
) as Dictionary
const displayNames = getEstablishedEntityDisplayNames(dictionary.entities)
const carlCox = dictionary.entities.find(({ id }) => id === 'artist_carl_cox')
const organicHouse = dictionary.entities.find(({ id }) => id === 'genre_organic_house')
const sasha = dictionary.entities.find(({ id }) => id === 'artist_sasha')
const amelieLens = dictionary.entities.find(({ id }) => id === 'artist_amelie_lens')

test('Carl Cox is an established Korean entity and dictionary count is accurate', () => {
  assert.ok(carlCox)
  assert.equal(carlCox.ko, '칼 콕스')
  assert.equal(carlCox.ko_status, 'established')
  assert.ok(carlCox.ko_avoid.includes('칼빈 콕스'))
  assert.equal(
    dictionary.counts.ko_established,
    dictionary.entities.filter(({ ko_status }) => ko_status === 'established').length
  )
  assert.equal(dictionary.counts.total, dictionary.entities.length)
})

test('organic house uses the editorial Korean genre name and corrects literal translations', () => {
  assert.ok(organicHouse)
  assert.equal(organicHouse.ko, '오가닉 하우스')
  assert.deepEqual(organicHouse.ko_avoid, ['유기적인 하우스', '유기 하우스'])
  assert.equal(
    applyDisplayNameMappingToTitle("KSHMR, 새로운 프로젝트 'TEJA'로 유기 하우스 앨범 발표", displayNames),
    "카슈미르, 새로운 프로젝트 'TEJA'로 오가닉 하우스 앨범 발표"
  )
  assert.equal(
    applyKoreanAvoidCorrections('유기적인 하우스와 유기 하우스 음악을 선보인다.', displayNames),
    '오가닉 하우스와 오가닉 하우스 음악을 선보인다.'
  )
})

test('Sasha uses the editorial Korean display name', () => {
  assert.ok(sasha)
  assert.equal(sasha.ko, '사샤')
  assert.equal(sasha.ko_status, 'established')
  assert.deepEqual(sasha.ko_avoid, ['샤샤'])
  assert.equal(applyDisplayNameMappingToTitle('Sasha 공연 확정', displayNames), '사샤 공연 확정')
  assert.equal(
    applyKoreanAvoidCorrections('샤샤(Sasha)가 공연한다.', displayNames),
    '사샤(Sasha)가 공연한다.'
  )
})

test('Amelie Lens is an active established display name', () => {
  assert.ok(amelieLens)
  assert.equal(amelieLens.ko, '아멜리 렌즈')
  assert.equal(amelieLens.ko_status, 'established')
  assert.ok(amelieLens.ko_avoid.includes('아멜리아 렌즈'))
  assert.equal(
    applyDisplayNameMappingToTitle('Amelie Lens & Sara Landry 첫 B2B', displayNames),
    '아멜리 렌즈 & Sara Landry 첫 B2B'
  )
  assert.equal(
    applyKoreanAvoidCorrections('아멜리아 렌즈(Amelie Lens)가 공연했다.', displayNames),
    '아멜리 렌즈(Amelie Lens)가 공연했다.'
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

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
// @ts-expect-error Node's TypeScript test runner requires the source extension at runtime.
import { applyKoreanEditorialTermCorrections, formatKoreanEditorialTermRules } from '../lib/jobs/editorial-terms.ts'

type EditorialTerms = {
  korean_terms: Array<{
    sources: string[]
    preferred: string
    avoid: string[]
    guidance: string
  }>
}

const dictionary = JSON.parse(
  readFileSync(new URL('../lib/editorial-terms.json', import.meta.url), 'utf8')
) as EditorialTerms

test('music publishing uses the editorial Korean industry term', () => {
  assert.equal(
    applyKoreanEditorialTermCorrections(
      '하드웰이 음악 출판 계약을 맺고 음악 출판 분야에 진출했다.',
      dictionary.korean_terms,
    ),
    '하드웰이 퍼블리싱 계약을 맺고 퍼블리싱 분야에 진출했다.'
  )
  assert.match(
    formatKoreanEditorialTermRules(dictionary.korean_terms),
    /music publishing \/ 音楽出版 → 퍼블리싱/,
  )
  assert.match(
    formatKoreanEditorialTermRules(dictionary.korean_terms),
    /음악 산업 문맥에서는 '출판'으로 번역하지 말고 '퍼블리싱'을 사용/,
  )
  assert.match(
    formatKoreanEditorialTermRules(dictionary.korean_terms),
    /"음악 출판" 사용 금지/,
  )
})

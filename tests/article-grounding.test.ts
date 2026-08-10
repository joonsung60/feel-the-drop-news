import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
// @ts-expect-error The test runner loads the TypeScript source directly.
import { getSourceDisplayNames, validateArticleGrounding } from '../lib/article-grounding.ts'
// @ts-expect-error The test runner loads the TypeScript source directly.
import { SYSTEM_PROMPT_A } from '../lib/prompts.ts'

const dictionary = JSON.parse(
  readFileSync(new URL('../lib/edm-entities-v2.json', import.meta.url), 'utf8')
)
const policy = JSON.parse(
  readFileSync(new URL('../lib/entity-surface-policy.json', import.meta.url), 'utf8')
)

function validate(sourceEvidence: string, output: string) {
  return validateArticleGrounding({
    sourceEvidence,
    title: output,
    content: '',
    entities: dictionary.entities,
    policy,
  })
}

test('rejects Tiësto paired with unsupported Thomas Bangalter', () => {
  const result = validate('Thomas Bangalter announced a project.', '티에스토(Thomas Bangalter)')
  assert.equal(result.ok, false)
  assert.ok(result.issues.some(({ code }) => code === 'UNSUPPORTED_ENTITY'))
  assert.ok(result.issues.some(({ code }) => code === 'MISMATCHED_ENTITY_PAIR'))
})

test('rejects Tomorrowland when the source only names Shambhala Music Festival', () => {
  const result = validate('Shambhala Music Festival announced its dates.', '투모로우랜드가 행사를 개최한다')
  assert.equal(result.ok, false)
  assert.ok(result.issues.some(({ code }) => code === 'UNSUPPORTED_ENTITY'))
})

test('rejects The Chainsmokers when the source only names Ultra Japan', () => {
  const result = validate('Ultra Japan announced its schedule.', '체인스모커스(The Chainsmokers)가 출연한다')
  assert.equal(result.ok, false)
  assert.ok(result.issues.some(({ code }) => code === 'UNSUPPORTED_ENTITY'))
})

test('accepts matching established Korean and English surfaces from the source', () => {
  assert.equal(validate('Tiësto released a track.', '티에스토(Tiësto)가 신곡을 공개했다').ok, true)
  assert.equal(validate('Tiësto released a track.', '티에스토(Tiesto)가 신곡을 공개했다').ok, true)
})

test('ignores Korean descriptions and numbers in parentheses after a known Korean entity', () => {
  assert.equal(validate('Tiësto is a Dutch DJ.', '티에스토(네덜란드 출신)가 신곡을 공개했다').ok, true)
  assert.equal(validate('Tiësto is 56 years old.', '티에스토(56)가 신곡을 공개했다').ok, true)
})

test('accepts an English-only ko_status=none festival without inventing a display rule', () => {
  const source = 'Shambhala Music Festival announced its dates.'
  assert.equal(validate(source, 'Shambhala Music Festival 일정 공개').ok, true)
  assert.deepEqual(getSourceDisplayNames(source, dictionary.entities, policy), [])
})

test('accepts an unregistered source entity in its original English form', () => {
  assert.equal(validate('Thomas Bangalter announced a project.', 'Thomas Bangalter 프로젝트 공개').ok, true)
})

test('does not match an English entity surface inside an ASCII word', () => {
  assert.equal(validate('Thomas Bangalter announced a project.', 'The Tiestoed remix is unrelated.').ok, true)
})

test('fails closed when source evidence is unavailable', () => {
  const result = validate('', 'Thomas Bangalter 프로젝트 공개')
  assert.equal(result.ok, false)
  assert.equal(result.issues[0].code, 'SOURCE_EVIDENCE_UNAVAILABLE')
})

test('source-scoped display names contain only the established entity found in evidence', () => {
  const displayNames = getSourceDisplayNames('Tiësto released a track.', dictionary.entities, policy)
  assert.deepEqual(displayNames.map(({ en }: { en: string }) => en), ['Tiësto'])
  assert.equal(displayNames.some(({ en }: { en: string }) => en === 'Tomorrowland'), false)
  assert.equal(displayNames.some(({ en }: { en: string }) => en === 'The Chainsmokers'), false)
  assert.notEqual(displayNames.length, dictionary.counts.ko_established)
})

test('cluster fixed prompts do not contain unrelated real artist examples', () => {
  const clusterSource = readFileSync(new URL('../lib/jobs/generate-from-cluster.ts', import.meta.url), 'utf8')
  assert.equal(SYSTEM_PROMPT_A.includes('Conducta'), false)
  assert.equal(clusterSource.includes('메 엔 유'), false)
})

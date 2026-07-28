import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  loadEntityDictionaryFromFiles,
  parseEntityDictionary,
} from '../lib/suggest/entity-index'

const dictionary = {
  entities: [
    { en: 'COEX THE PLATZ', aliases_en: ['THE PLATZ'], weight: 1 },
    { en: 'Pioneer DJ', aliases_en: ['Pioneer'], weight: 0.6 },
    { en: 'Disclosure', aliases_en: [], weight: 1 },
  ],
}

const policy = {
  version: 2,
  entities: {
    'COEX THE PLATZ': { role: 'supporting' },
    'Pioneer DJ': {
      contextual_surfaces: {
        Pioneer: { after: ['DJ'], max_gap_chars: 4 },
      },
    },
    Disclosure: {
      contextual_surfaces: {
        Disclosure: { after: ['release'], max_gap_chars: 8 },
      },
    },
  },
}

function parse(dict: unknown = dictionary, surfacePolicy: unknown = policy) {
  return parseEntityDictionary(JSON.stringify(dict), JSON.stringify(surfacePolicy))
}

test('valid v2 dictionary and policy load with roles and contextual surfaces', () => {
  const entries = parse()
  assert.equal(entries.find(({ canonical }) => canonical === 'COEX THE PLATZ')?.role, 'supporting')
  const disclosure = entries.find(({ canonical }) => canonical === 'Disclosure')
  assert.deepEqual(disclosure?.surfaces, [])
  assert.equal(disclosure?.contextualSurfaces?.[0].surface, 'disclosure')
})

test('broken v2 never falls back to a present legacy dictionary', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'feel-drop-entity-loader-'))
  const v2Path = path.join(directory, 'edm-entities-v2.json')
  const policyPath = path.join(directory, 'entity-surface-policy.json')
  writeFileSync(v2Path, '{broken', 'utf8')
  writeFileSync(policyPath, JSON.stringify(policy), 'utf8')
  writeFileSync(
    path.join(directory, 'edm-entities.json'),
    JSON.stringify({
      artists_top500_relevance_2024_2025: [
        { name: 'Disclosure', aliases: ['disclosure'], weight: 1 },
      ],
    }),
    'utf8',
  )
  assert.throws(
    () => loadEntityDictionaryFromFiles(v2Path, policyPath),
    /v2 entity dictionary JSON parse failed/,
  )
})

test('invalid dictionary and policy structures fail closed', () => {
  const cases: Array<[string, unknown, unknown, RegExp]> = [
    ['missing entities array', {}, policy, /entities must be an array/],
    ['invalid role', dictionary, {
      ...policy,
      entities: { ...policy.entities, 'COEX THE PLATZ': { role: 'strong' } },
    }, /invalid entity role/],
    ['contextual surfaces array', dictionary, {
      ...policy,
      entities: { Disclosure: { contextual_surfaces: [] } },
    }, /contextual_surfaces.*must be an object/],
    ['contextual surfaces string', dictionary, {
      ...policy,
      entities: { Disclosure: { contextual_surfaces: 'Disclosure' } },
    }, /contextual_surfaces.*must be an object/],
    ['before string', dictionary, {
      ...policy,
      entities: {
        Disclosure: { contextual_surfaces: { Disclosure: { before: 'DJ duo' } } },
      },
    }, /before must be an array/],
    ['negative max gap', dictionary, {
      ...policy,
      entities: {
        Disclosure: {
          contextual_surfaces: { Disclosure: { after: ['release'], max_gap_chars: -1 } },
        },
      },
    }, /max_gap_chars must be a non-negative integer/],
    ['missing canonical', dictionary, {
      ...policy,
      entities: { 'COEX THE PLAZ': { role: 'supporting' } },
    }, /policy canonical not found/],
    ['missing contextual surface', dictionary, {
      ...policy,
      entities: {
        'Pioneer DJ': { contextual_surfaces: { Pioner: { after: ['DJ'] } } },
      },
    }, /policy contextual surface not found/],
  ]
  for (const [name, dict, surfacePolicy, expected] of cases) {
    assert.throws(() => parse(dict, surfacePolicy), expected, name)
  }
})

test('failed contextual policy cannot restore Disclosure as a strong surface', () => {
  const typoPolicy = {
    ...policy,
    entities: {
      Disclosure: {
        contextual_surfaces: {
          Disclosur: { after: ['release'] },
        },
      },
    },
  }
  assert.throws(() => parse(dictionary, typoPolicy), /policy contextual surface not found/)
})

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import {
  buildEntityIndex,
  loadEntityDictionary,
  parseEntityDictionary,
} from '../lib/suggest/entity-index'
import {
  correspondentApprovalPath,
  hasExplicitEdmEvidence,
  partitionArticlesByEntityRole,
  selectEligibleLlmInput,
} from '../lib/suggest/eligibility'
import type { RawArticle } from '../lib/suggest/types'

const BATCH_START = '2026-08-04T08:46:35Z'
const BATCH_END = '2026-08-04T08:49:30Z'
const EXPECTED_COUNT = 123
const LLM_INPUT_MAX = 120
const NO_ENTITY_RATIO_MAX = 0.6
const OUTPUT_PATH = path.join(process.cwd(), 'research/entity-recall-audit-2026-08-04.json')
const ADDENDUM_PATH = path.join(process.cwd(), 'research/entity-addendum-2026-08-04.json')
const DICTIONARY_PATH = path.join(process.cwd(), 'lib/edm-entities-v2.json')
const POLICY_PATH = path.join(process.cwd(), 'lib/entity-surface-policy.json')

type AuditArticle = RawArticle & {
  origin: string | null
  fetched_at: string
}

type PartitionName = 'qualifying' | 'danceExperience' | 'supportingOnly' | 'notMatched'
type EditorialLabel = 'editorially_relevant' | 'editorially_irrelevant' | 'ambiguous'

const RELEVANT_TITLES = new Set([
  'Getting Started with Vital, the Outsized But Totally Free Soft Synth',
  'Emanuele Cisi & Joe Claussell Get Spiritual on “Pharoah’s Message” Remixes',
  'Rewind: Souldynamic release 10th anniversary edition of “Equatoriale”',
  'Pittsburgh Modular Lifeforms SV-2 Sneak Preview',
  'Roland JD-990 Emulator, JADE, Now In Development (Sneak Preview)',
  'The Beginner’s Guide To Game Boy Chiptune',
  'Mount Kimbie Release fabric presents Compilation',
  'Above & Beyond、結成25周年記念ミックス「One Mix」をApple Musicで公開',
  'Vintage Culture、新鋭2組とタッグを組み、パンクのエッジを効かせたテックハウスナンバーをリリース',
  'Best MIDI Controllers For Hybrid Studios Without Routing Headaches',
  'Paco Wegmann Talks “Mais Forte,” Patience, And Long-Term Success',
  'El Tony Sends Producers to Ibiza',
  'JUNØID Turns Betrayal Into Neon',
  'PREMIERE: Christian Hornbostel Brings “Eridanus” to Magnetic',
  'Cale Anderson On Goddess Worship, Folktronica, And Yemaya',
  'Chilsta Steps Further Into Creative Exploration with Latest Single “Back”',
  'Kashovski Finds Common Ground with Moojo on ‘Show Me’',
  'Chilsta – ‘Back’',
  '5 Acts to Catch at ARC Music Festival 2026',
  'Eliza Rose and Sega Bodega link up on new single, ‘Kite’: Listen',
  'Stayin’ Alive: the history of the disco ball',
  'Watch the Tomorrowland 2026 official aftermovie',
  "Two attendees die at Hungary's Ozora Festival, event ends early",
  'Listen to Fred again.. and LATIN MAFIA’s ‘9 months & 50 hours’ mixtape',
  'salute and Riva Starr link up on new single, ‘soulreply’: Listen',
  'BBC Radio 6 Music to celebrate Black British dance music with new show, Rave Forever',
  'Nutritious: Solarmaxxing (Liquid Culture Records)',
  'Function: Aeternum (Existenz) (Tresor Records)',
  'Australia’s Beyond The Valley drops 2026 lineup including KI/KI, Boys Noize, Skepta, & more',
  'Native Instrument’s SuperStarSaw Review',
  'DASH – Without You',
  'Deadcrow & Caster – Euphoria',
  'Matty Ralph, JOKESONYOU – Heaven',
  'Electronic Groove releases charity compilation for Venezuela relief',
  'Alex Generis turns grief and memory into music on ‘You Bought Flowers’',
  'Purple Tape: “The industry rewards noise, but the culture rewards care”',
  'Cyprus’ KAMAYA Festival announces lineup with Dixon, Mind Against, & more',
  'Maceo Plex shares free download of his Kavinsky’s ‘Nightcall’ remix',
  'Eastern Electrics returns with East End Dubs, Joseph Capriati, & more',
  'fabric unveils lineup for 27th birthday weekend',
  "North Shields' Are You Affiliated launches promoter support scheme",
  'Push Hack, very unauthorized access to Push 3’s display, files, MIDI, and more',
  'Nach zwei Todesfällen: Ungarisches Psytrance-Festival vorzeitig beendet',
  'Your Ears Are Your Career: A Complete Guide to Hearing Protection in the Music Industry',
  'Chuck Daniels ‘The Remixes’ marks the return of Sampled Detroit with six remastered productions',
  'Maribou State announces new album ‘Hallucinating Love’ via Ninja Tune',
  'Turning Points: David Penn',
  '[INTERVIEW] Denis First Talks ‘Sweet Summer Nights’, Next Projects, Living Without Music, And More',
  'Sullivan King, TRYM & Graphyt Unite on ‘Rumble’',
  'Alan Walker Drops ‘Pain’ for Fatal Fury: City of the Wolves',
  'Kaskade Announces ORIGIN// Tour Featuring The Acclaimed Coachella Stage Production',
  'Lukaku, De Bruyne & More Join Dimitri Vegas During Tomorrowland and Ushuaïa Ibiza Sets',
  'EDMTunes Chats with Aaron Hibell at Tomorrowland 2026',
  'This Music Festival Was Abruptly Cancelled After Two Deaths',
  'Vintage Culture Reflects on Overthinking With New Single ‘Think Too Much’',
  'Two Children Set Guinness World Record as Youngest DJ Duo',
  'Meta Glasses + DJing = The Ultimate POV?',
  'San Diego’s LED Presents Drops Bass-Heavy Lineup For New Temper Festival At Petco Park',
  'Escape Halloween Confirms Full 2026 Lineup',
  'Kaskade To Bring Immersive ‘ORIGIN //’ Live Show To Four U.S. Cities This Fall',
  '#MyRecordBag – Giom’s 2000s house classics',
  'sachi’s mirror, “Talking in a Different Way”',
  'The Tape Label Report, July 2026',
  'Yorkshire experimental composer Kirk Barley releases new album Arc',
  'Review: Tiestö at Silverworks Island',
  'Watch Tomorrowland 2026 sets from Martin Garrix, Hardwell, Charlotte de Witte, Sara Landry and more',
  'Fred again.. & LATIN MAFIA release joint mixtape ‘9 months & 50 hours’: Listen',
  'Carl Cox shares rare 1996 photo from Portugal: ‘Before USBs, it was all about the records’',
  'Above & Beyond celebrate 25 years with career-spanning One Mix on Apple Music in Spatial Audio',
  'Mat Weasel Busters, pioneering figure of Hardtek and Frenchcore, has died',
  'Jan Wayne announces retirement at the end of 2027 after 35 years behind the decks',
  'Best wired headphones under $500 in 2026: Our picks for mixing, DJing and music production',
])

const AMBIGUOUS_TITLES = new Set([
  'Roland GO:KEYS 3 Minion Keyboard Coming In Sept',
  'Rum Music for August Reviewed by Jennifer Lucy Allan',
  'HIIIT – SIIIX, Vol. 3',
  'The July Catch-up Playlist is Here',
  'Gigi Masin on Movement, the age of sampling, and thinking analog',
  'Adam Wiltzie (Stars of the Lid) announces collab LP with Jóhann Jóhannsson',
])

const FALSE_NEGATIVE_CAUSES = new Map<string, string>([
  ['PREMIERE: Christian Hornbostel Brings “Eridanus” to Magnetic', 'missing_entity'],
  ['Best MIDI Controllers For Hybrid Studios Without Routing Headaches', 'classification_not_solvable_by_entity'],
  ['JUNØID Turns Betrayal Into Neon', 'missing_entity'],
  ['Chilsta Steps Further Into Creative Exploration with Latest Single “Back”', 'missing_entity'],
  ['Kashovski Finds Common Ground with Moojo on ‘Show Me’', 'missing_entity'],
  ['Eliza Rose and Sega Bodega link up on new single, ‘Kite’: Listen', 'missing_entity'],
  ['Stayin’ Alive: the history of the disco ball', 'classification_not_solvable_by_entity'],
  ['DASH – Without You', 'ambiguous_surface_policy'],
  ['Deadcrow & Caster – Euphoria', 'missing_entity'],
  ['Electronic Groove releases charity compilation for Venezuela relief', 'missing_entity'],
  ['Alex Generis turns grief and memory into music on ‘You Bought Flowers’', 'missing_entity'],
  ["North Shields' Are You Affiliated launches promoter support scheme", 'missing_entity'],
  ['Push Hack, very unauthorized access to Push 3’s display, files, MIDI, and more', 'entity_after_500_chars'],
  ['Nach zwei Todesfällen: Ungarisches Psytrance-Festival vorzeitig beendet', 'missing_entity'],
  ['[INTERVIEW] Denis First Talks ‘Sweet Summer Nights’, Next Projects, Living Without Music, And More', 'missing_entity'],
  ['This Music Festival Was Abruptly Cancelled After Two Deaths', 'missing_entity'],
  ['San Diego’s LED Presents Drops Bass-Heavy Lineup For New Temper Festival At Petco Park', 'missing_entity'],
  ['#MyRecordBag – Giom’s 2000s house classics', 'missing_entity'],
  ['Yorkshire experimental composer Kirk Barley releases new album Arc', 'missing_entity'],
  ['Review: Tiestö at Silverworks Island', 'alias_missing'],
])

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} environment variable is required`)
  return value
}

function sorted(values: Set<string> | undefined): string[] {
  return [...(values ?? [])].sort((a, b) => a.localeCompare(b))
}

function countsFor(rows: Array<{ partition: PartitionName; explicit_fallback: boolean; llm_eligible: boolean }>) {
  return {
    total: rows.length,
    qualifying: rows.filter((row) => row.partition === 'qualifying').length,
    danceExperience: rows.filter((row) => row.partition === 'danceExperience').length,
    supportingOnly: rows.filter((row) => row.partition === 'supportingOnly').length,
    notMatched: rows.filter((row) => row.partition === 'notMatched').length,
    explicit_fallback: rows.filter((row) => row.explicit_fallback).length,
    final_llm_eligible: rows.filter((row) => row.llm_eligible).length,
  }
}

function editorialLabel(title: string): EditorialLabel {
  if (RELEVANT_TITLES.has(title)) return 'editorially_relevant'
  if (AMBIGUOUS_TITLES.has(title)) return 'ambiguous'
  return 'editorially_irrelevant'
}

function metric(value: number, denominator: number): number | null {
  return denominator === 0 ? null : Number((value / denominator).toFixed(4))
}

function confusionFor(rows: Array<{ editorial_label: EditorialLabel; llm_eligible: boolean }>) {
  const decided = rows.filter((row) => row.editorial_label !== 'ambiguous')
  const truePositive = decided.filter((row) => row.editorial_label === 'editorially_relevant' && row.llm_eligible).length
  const falsePositive = decided.filter((row) => row.editorial_label === 'editorially_irrelevant' && row.llm_eligible).length
  const falseNegative = decided.filter((row) => row.editorial_label === 'editorially_relevant' && !row.llm_eligible).length
  const trueNegative = decided.filter((row) => row.editorial_label === 'editorially_irrelevant' && !row.llm_eligible).length
  return {
    true_positive: truePositive,
    false_positive: falsePositive,
    false_negative: falseNegative,
    true_negative: trueNegative,
    ambiguous: rows.length - decided.length,
    precision: metric(truePositive, truePositive + falsePositive),
    recall: metric(truePositive, truePositive + falseNegative),
  }
}

async function main() {
  const supabase = createClient(
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const { data, error } = await supabase
    .from('raw_articles')
    .select('id, title, content, url, source_id, published_at, event_date, facts, origin, fetched_at')
    .gte('fetched_at', BATCH_START)
    .lte('fetched_at', BATCH_END)
    .order('fetched_at', { ascending: true })
    .order('id', { ascending: true })

  if (error) throw new Error(`raw_articles SELECT failed: ${error.message}`)
  if (data.length !== EXPECTED_COUNT) {
    throw new Error(`batch cardinality mismatch: expected ${EXPECTED_COUNT}, got ${data.length}`)
  }

  const sourceIds = [...new Set(data.map((row) => row.source_id).filter((id) => id !== null))]
  const { data: sources, error: sourceError } = await supabase
    .from('rss_sources')
    .select('id, name')
    .in('id', sourceIds)
  if (sourceError) throw new Error(`rss_sources SELECT failed: ${sourceError.message}`)

  const sourceNames = new Map(sources.map((source) => [String(source.id), source.name]))
  const articles = data.map((row) => ({
    ...row,
    sourceName: row.source_id === null ? undefined : sourceNames.get(String(row.source_id)) ?? undefined,
  })) as AuditArticle[]

  const dictionary = loadEntityDictionary()
  const index = buildEntityIndex(articles, dictionary)
  const partition = partitionArticlesByEntityRole(
    articles,
    index.articleEntities,
    index.articleSupportingEntities,
  )
  const selected = selectEligibleLlmInput(partition, LLM_INPUT_MAX, NO_ENTITY_RATIO_MAX)
  const eligibleIds = new Set(selected.input.map((article) => article.id))
  const fallbackIds = new Set(selected.noEntitySelected.map((article) => article.id))
  const partitionById = new Map<string, PartitionName>()
  for (const name of ['qualifying', 'danceExperience', 'supportingOnly', 'notMatched'] as const) {
    for (const article of partition[name]) partitionById.set(article.id, name)
  }

  const rows = articles.map((article) => {
    const partitionName = partitionById.get(article.id)
    if (!partitionName) throw new Error(`missing partition for article ${article.id}`)
    const qualifyingEntities = sorted(index.articleEntities.get(article.id))
    const qualifyingSurfaces = sorted(index.articleMentions.get(article.id))
    const supportingEntities = sorted(index.articleSupportingEntities.get(article.id))
    const supportingSurfaces = sorted(index.articleSupportingMentions.get(article.id))
    const approvalPath = correspondentApprovalPath(article)
    const explicitEvidence = hasExplicitEdmEvidence(article)
    const llmEligible = eligibleIds.has(article.id)
    const passPath = qualifyingEntities.length > 0 && llmEligible
      ? 'entity'
      : partitionName === 'danceExperience' && llmEligible
        ? 'dance_experience'
        : fallbackIds.has(article.id)
          ? 'explicit_edm_fallback'
          : 'rejected'
    const label = editorialLabel(article.title)
    const contentExcerpt = (article.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 800)
    const falseNegativeCause = label === 'editorially_relevant' && !llmEligible
      ? FALSE_NEGATIVE_CAUSES.get(article.title) ?? 'other'
      : null
    return {
      article_id: article.id,
      source_name: article.sourceName ?? null,
      title: article.title,
      content: article.content,
      url: article.url,
      origin: article.origin,
      published_at: article.published_at ?? null,
      fetched_at: article.fetched_at,
      qualifying_entities: qualifyingEntities,
      qualifying_surfaces: qualifyingSurfaces,
      supporting_entities: supportingEntities,
      supporting_surfaces: supportingSurfaces,
      correspondent_approval_path: approvalPath,
      has_explicit_edm_evidence: explicitEvidence,
      partition: partitionName,
      explicit_fallback: fallbackIds.has(article.id),
      llm_eligible: llmEligible,
      pass_path: passPath,
      editorial_label: label,
      editorial_evidence: {
        title: article.title,
        content_excerpt: contentExcerpt || null,
      },
      false_negative_cause: falseNegativeCause,
    }
  })

  const baseDictionary = JSON.parse(fs.readFileSync(DICTIONARY_PATH, 'utf8')) as {
    entities: unknown[]
    [key: string]: unknown
  }
  const addendum = JSON.parse(fs.readFileSync(ADDENDUM_PATH, 'utf8')) as {
    entities: unknown[]
  }
  const combinedDictionary = {
    ...baseDictionary,
    entities: [...baseDictionary.entities, ...addendum.entities],
  }
  const counterfactualDictionary = parseEntityDictionary(
    JSON.stringify(combinedDictionary),
    fs.readFileSync(POLICY_PATH, 'utf8'),
  )
  const counterfactualIndex = buildEntityIndex(articles, counterfactualDictionary)
  const counterfactualPartition = partitionArticlesByEntityRole(
    articles,
    counterfactualIndex.articleEntities,
    counterfactualIndex.articleSupportingEntities,
  )
  const counterfactualSelected = selectEligibleLlmInput(
    counterfactualPartition,
    LLM_INPUT_MAX,
    NO_ENTITY_RATIO_MAX,
  )
  const counterfactualEligibleIds = new Set(counterfactualSelected.input.map((article) => article.id))
  const counterfactualRows = rows.map((row) => ({
    editorial_label: row.editorial_label,
    llm_eligible: counterfactualEligibleIds.has(row.article_id),
  }))
  const newlyEligible = rows
    .filter((row) => !row.llm_eligible && counterfactualEligibleIds.has(row.article_id))
    .map((row) => ({
      article_id: row.article_id,
      title: row.title,
      entities: sorted(counterfactualIndex.articleEntities.get(row.article_id))
        .filter((entity) => !row.qualifying_entities.includes(entity)),
    }))
  const currentConfusion = confusionFor(rows)
  const counterfactualConfusion = confusionFor(counterfactualRows)
  const falseNegativeCauseNames = [
    'missing_entity',
    'alias_missing',
    'ambiguous_surface_policy',
    'entity_after_500_chars',
    'explicit_edm_pattern_too_narrow',
    'extraction_failure',
    'classification_not_solvable_by_entity',
    'other',
  ]
  const falseNegativeCauses = Object.fromEntries(
    falseNegativeCauseNames
      .map((cause) => [
        cause,
        {
          count: rows.filter((row) => row.false_negative_cause === cause).length,
          articles: rows
            .filter((row) => row.false_negative_cause === cause)
            .map((row) => ({ article_id: row.article_id, title: row.title })),
        },
      ]),
  )

  const bySource = Object.fromEntries(
    [...new Set(rows.map((row) => row.source_name ?? '(unknown)'))]
      .sort((a, b) => a.localeCompare(b))
      .map((source) => [source, countsFor(rows.filter((row) => (row.source_name ?? '(unknown)') === source))]),
  )

  const output = {
    audit_version: 1,
    batch: {
      fetched_at_gte: BATCH_START,
      fetched_at_lte: BATCH_END,
      expected_count: EXPECTED_COUNT,
      actual_count: rows.length,
    },
    production_parameters: {
      entity_haystack_content_limit: 500,
      llm_input_max: LLM_INPUT_MAX,
      no_entity_ratio_max: NO_ENTITY_RATIO_MAX,
    },
    current_funnel: countsFor(rows),
    by_source: bySource,
    editorial_confusion_matrix: currentConfusion,
    false_negative_causes: falseNegativeCauses,
    blocker_diagnostics: {
      existing_dictionary_entity_present_but_not_matched_among_false_negatives: {
        boundary: 0,
        contextual_policy: 0,
        entity_after_500_chars: rows.filter((row) => row.false_negative_cause === 'entity_after_500_chars').length,
        total_unique: rows.filter((row) => row.false_negative_cause === 'entity_after_500_chars').length,
      },
      dictionary_missing_entity_false_negatives: rows.filter((row) =>
        row.false_negative_cause === 'missing_entity' || row.false_negative_cause === 'alias_missing'
      ).length,
    },
    counterfactual: {
      current_qualifying: partition.qualifying.length,
      addendum_qualifying: counterfactualPartition.qualifying.length,
      current_final_eligible: selected.input.length,
      addendum_final_eligible: counterfactualSelected.input.length,
      false_negative_reduction: currentConfusion.false_negative - counterfactualConfusion.false_negative,
      false_positive_increase: counterfactualConfusion.false_positive - currentConfusion.false_positive,
      current_precision: currentConfusion.precision,
      addendum_precision: counterfactualConfusion.precision,
      current_recall: currentConfusion.recall,
      addendum_recall: counterfactualConfusion.recall,
      newly_eligible: newlyEligible,
    },
    articles: rows,
  }

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ output: OUTPUT_PATH, current_funnel: output.current_funnel }))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

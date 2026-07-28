import fs from 'node:fs'
import path from 'node:path'
import { EntityEntry, RawArticle } from './types'
import { canMergeByEventDate } from './event-date'

export const ENTITY_DICTIONARY_PATH = 'lib/edm-entities-v2.json'
export const ENTITY_SURFACE_POLICY_PATH = 'lib/entity-surface-policy.json'
const SUPPORTED_POLICY_VERSION = 2

export const ENTITY_HAYSTACK_CONTENT_LIMIT = 500

type EntitySurfacePolicy = {
  version: number
  entities: Record<string, {
    role?: 'qualifying' | 'supporting'
    contextual_surfaces?: Record<string, {
      before?: string[]
      after?: string[]
      max_gap_chars?: number
    }>
  }>
}

type V2Entity = {
  en: string
  aliases_en: string[]
  weight: number
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(`${label} JSON parse failed: ${String(error)}`)
  }
}

function validateContextArray(value: unknown, label: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.trim())) {
    throw new Error(`${label} must be an array of non-empty strings`)
  }
  return value
}

function validatePolicy(raw: unknown): EntitySurfacePolicy {
  if (!isPlainObject(raw)) throw new Error('entity surface policy root must be an object')
  if (raw.version !== SUPPORTED_POLICY_VERSION) {
    throw new Error(`unsupported entity surface policy version: ${String(raw.version)}`)
  }
  if (!isPlainObject(raw.entities)) {
    throw new Error('entity surface policy entities must be an object')
  }
  for (const [canonical, config] of Object.entries(raw.entities)) {
    if (!canonical || !isPlainObject(config)) {
      throw new Error(`invalid entity surface policy for ${canonical}`)
    }
    if (config.role !== undefined && config.role !== 'qualifying' && config.role !== 'supporting') {
      throw new Error(`invalid entity role for ${canonical}: ${String(config.role)}`)
    }
    if (config.contextual_surfaces !== undefined && !isPlainObject(config.contextual_surfaces)) {
      throw new Error(`contextual_surfaces for ${canonical} must be an object`)
    }
    for (const [surface, rule] of Object.entries(config.contextual_surfaces ?? {})) {
      if (!surface || !isPlainObject(rule)) {
        throw new Error(`invalid contextual rule for ${canonical}/${surface}`)
      }
      const before = validateContextArray(rule.before, `${canonical}/${surface}.before`)
      const after = validateContextArray(rule.after, `${canonical}/${surface}.after`)
      if (before.length === 0 && after.length === 0) {
        throw new Error(`contextual rule for ${canonical}/${surface} requires before or after`)
      }
      if (
        rule.max_gap_chars !== undefined
        && (!Number.isInteger(rule.max_gap_chars) || (rule.max_gap_chars as number) < 0)
      ) {
        throw new Error(`${canonical}/${surface}.max_gap_chars must be a non-negative integer`)
      }
    }
  }
  return raw as EntitySurfacePolicy
}

function validateDictionary(raw: unknown): V2Entity[] {
  if (!isPlainObject(raw)) throw new Error('v2 entity dictionary root must be an object')
  if (!Array.isArray(raw.entities)) throw new Error('v2 entity dictionary entities must be an array')
  return raw.entities.map((entity, index) => {
    if (!isPlainObject(entity)) throw new Error(`v2 entity at index ${index} must be an object`)
    if (typeof entity.en !== 'string' || !entity.en.trim()) {
      throw new Error(`v2 entity at index ${index} requires a non-empty en`)
    }
    if (
      !Array.isArray(entity.aliases_en)
      || !entity.aliases_en.every((alias) => typeof alias === 'string' && alias.trim())
    ) {
      throw new Error(`v2 entity ${entity.en} aliases_en must be an array of non-empty strings`)
    }
    if (typeof entity.weight !== 'number' || !Number.isFinite(entity.weight)) {
      throw new Error(`v2 entity ${entity.en} requires a finite weight`)
    }
    return { en: entity.en, aliases_en: entity.aliases_en, weight: entity.weight }
  })
}

export function parseEntityDictionary(
  dictionaryRaw: string,
  policyRaw: string,
): EntityEntry[] {
  const entities = validateDictionary(parseJson(dictionaryRaw, 'v2 entity dictionary'))
  const policy = validatePolicy(parseJson(policyRaw, 'entity surface policy'))
  const entitiesByName = new Map(entities.map((entity) => [entity.en, entity]))

  for (const [canonical, config] of Object.entries(policy.entities)) {
    const entity = entitiesByName.get(canonical)
    if (!entity) throw new Error(`policy canonical not found in v2 dictionary: ${canonical}`)
    const knownSurfaces = new Set([entity.en, ...entity.aliases_en].map((surface) => surface.toLowerCase()))
    for (const surface of Object.keys(config.contextual_surfaces ?? {})) {
      if (!knownSurfaces.has(surface.toLowerCase())) {
        throw new Error(`policy contextual surface not found for ${canonical}: ${surface}`)
      }
    }
  }

  return entities.map((entity) => {
    const config = policy.entities[entity.en] ?? {}
    const contextualPolicy = config.contextual_surfaces ?? {}
    const contextualKeys = new Set(
      Object.keys(contextualPolicy).map((surface) => surface.toLowerCase()),
    )
    const surfaces = [entity.en, ...entity.aliases_en]
      .map((surface) => surface.toLowerCase())
      .filter((surface) => surface.length >= 2 && !contextualKeys.has(surface))
    const contextualSurfaces = Object.entries(contextualPolicy).map(([surface, rule]) => ({
      surface: surface.toLowerCase(),
      beforeContexts: (rule.before ?? []).map((context) => context.toLowerCase()),
      afterContexts: (rule.after ?? []).map((context) => context.toLowerCase()),
      maxGapChars: rule.max_gap_chars ?? 12,
    }))
    if (surfaces.length === 0 && contextualSurfaces.length === 0) {
      throw new Error(`v2 entity has no usable surfaces: ${entity.en}`)
    }
    return {
      canonical: entity.en,
      role: config.role ?? 'qualifying',
      surfaces,
      contextualSurfaces,
      weight: entity.weight,
    }
  })
}

export function loadEntityDictionaryFromFiles(
  dictionaryPath: string,
  policyPath: string,
): EntityEntry[] {
  return parseEntityDictionary(
    fs.readFileSync(dictionaryPath, 'utf-8'),
    fs.readFileSync(policyPath, 'utf-8'),
  )
}

export function loadEntityDictionary(): EntityEntry[] {
  const dictionaryPath = path.join(process.cwd(), ENTITY_DICTIONARY_PATH)
  const policyPath = path.join(process.cwd(), ENTITY_SURFACE_POLICY_PATH)
  const entries = loadEntityDictionaryFromFiles(dictionaryPath, policyPath)
  console.log(`[suggest-clusters] entity dict loaded from ${ENTITY_DICTIONARY_PATH}: ${entries.length} entries`)
  return entries
}

export function findSurfaceInText(text: string, surface: string): boolean {
  if (!surface || surface.length < 2) return false
  let from = 0
  while (true) {
    const i = text.indexOf(surface, from)
    if (i < 0) return false
    const before = i === 0 ? ' ' : text[i - 1]
    const after = i + surface.length >= text.length ? ' ' : text[i + surface.length]
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true
    from = i + 1
  }
}

export function findContextualSurfaceInText(
  text: string,
  surface: string,
  beforeContexts: string[],
  afterContexts: string[],
  maxGapChars: number,
): boolean {
  const hasBoundary = (index: number, value: string): boolean => {
    const before = index === 0 ? ' ' : text[index - 1]
    const end = index + value.length
    const after = end >= text.length ? ' ' : text[end]
    return !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)
  }
  const allowedGap = (gap: string): boolean => {
    if (gap.length > maxGapChars) return false
    return /^[\s,.:;()'"\[\]\-–—]*$/.test(gap.replace(/\bthe\b/g, ''))
  }
  const contextMatches = (
    contexts: string[],
    contextBeforeSurface: boolean,
    surfaceIndex: number,
    surfaceEnd: number,
  ): boolean => contexts.some((context) => {
    let contextIndex = text.indexOf(context)
    while (contextIndex >= 0) {
      if (hasBoundary(contextIndex, context)) {
        const contextEnd = contextIndex + context.length
        const gap = contextBeforeSurface
          ? text.slice(contextEnd, surfaceIndex)
          : text.slice(surfaceEnd, contextIndex)
        if (
          (contextBeforeSurface ? contextEnd <= surfaceIndex : contextIndex >= surfaceEnd)
          && allowedGap(gap)
        ) {
          return true
        }
      }
      contextIndex = text.indexOf(context, contextIndex + 1)
    }
    return false
  })

  let from = 0
  while (true) {
    const index = text.indexOf(surface, from)
    if (index < 0) return false
    const end = index + surface.length
    if (
      hasBoundary(index, surface)
      && (
        contextMatches(beforeContexts, true, index, end)
        || contextMatches(afterContexts, false, index, end)
      )
    ) {
      return true
    }
    from = index + 1
  }
}

export function buildEntityIndex(
  articles: RawArticle[],
  dict: EntityEntry[],
): {
  articleEntities: Map<string, Set<string>>
  articleMentions: Map<string, Set<string>>
  articleSupportingEntities: Map<string, Set<string>>
  articleSupportingMentions: Map<string, Set<string>>
  entityArticles: Map<string, Set<string>>
} {
  const articleEntities = new Map<string, Set<string>>()
  const articleMentions = new Map<string, Set<string>>()
  const articleSupportingEntities = new Map<string, Set<string>>()
  const articleSupportingMentions = new Map<string, Set<string>>()
  const entityArticles = new Map<string, Set<string>>()
  for (const article of articles) {
    const haystack = `${article.title ?? ''}\n${(article.content ?? '').slice(0, ENTITY_HAYSTACK_CONTENT_LIMIT)}`.toLowerCase()
    const matched = new Set<string>()
    const mentioned = new Set<string>()
    const supporting = new Set<string>()
    const supportingMentioned = new Set<string>()
    for (const entry of dict) {
      const strongSurface = entry.surfaces.find((surface) => findSurfaceInText(haystack, surface))
      const contextualSurface = entry.contextualSurfaces?.find(({
        surface, beforeContexts, afterContexts, maxGapChars,
      }) =>
        findContextualSurfaceInText(
          haystack,
          surface,
          beforeContexts,
          afterContexts,
          maxGapChars,
        )
      )
      if (strongSurface || contextualSurface) {
        const surface = strongSurface ?? contextualSurface!.surface
        if (entry.role === 'supporting') {
          supporting.add(entry.canonical)
          supportingMentioned.add(surface)
        } else {
          matched.add(entry.canonical)
          mentioned.add(surface)
        }
      }
    }
    articleEntities.set(article.id, matched)
    articleMentions.set(article.id, mentioned)
    articleSupportingEntities.set(article.id, supporting)
    articleSupportingMentions.set(article.id, supportingMentioned)
    for (const canonical of matched) {
      if (!entityArticles.has(canonical)) entityArticles.set(canonical, new Set())
      entityArticles.get(canonical)!.add(article.id)
    }
  }
  return {
    articleEntities,
    articleMentions,
    articleSupportingEntities,
    articleSupportingMentions,
    entityArticles,
  }
}

const PAIR_SCORE_SHARED_ENTITIES_2 = 3
const PAIR_SCORE_SHARED_ENTITIES_1 = 1
const PAIR_SCORE_DATE_3DAYS = 3
const PAIR_SCORE_DATE_7DAYS = 1
const PAIR_SCORE_TITLE_WORD = 2
const PAIR_MIN_SCORE = 3

const TITLE_EXCLUDE_WORDS = new Set([
  'feat', 'ft', 'remix', 'ep', 'album', 'single', 'track',
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with'
])

function getTitleWords(title: string): Set<string> {
  const tokens = title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
  const words = new Set<string>()
  for (const token of tokens) {
    if (token.length > 1 && !TITLE_EXCLUDE_WORDS.has(token)) {
      words.add(token)
    }
  }
  return words
}

export function buildPairClusters(
  rawArticles: RawArticle[],
  articleEntities: Map<string, Set<string>>,
  entityArticles: Map<string, Set<string>>,
  dict: EntityEntry[]
): { entity: string, articleIds: string[], weightSum: number }[] {
  const articlesMap = new Map(rawArticles.map(a => [a.id, a]))
  const titleWordsMap = new Map(rawArticles.map(a => [a.id, getTitleWords(a.title)]))
  const qualifyingEntities = new Set(
    dict.filter((entry) => entry.role !== 'supporting').map((entry) => entry.canonical)
  )
  
  // 엔터티당 기사 최대 15개로 제한
  const filteredEntityArticles = new Map<string, string[]>()
  for (const [entity, articleIdSet] of entityArticles.entries()) {
    if (!qualifyingEntities.has(entity)) continue
    let ids = Array.from(articleIdSet)
    if (ids.length > 15) {
      ids.sort((a, b) => {
        const da = articlesMap.get(a)?.published_at ?? ''
        const db = articlesMap.get(b)?.published_at ?? ''
        return db.localeCompare(da)
      })
      ids = ids.slice(0, 15)
    }
    if (ids.length >= 2) {
      filteredEntityArticles.set(entity, ids)
    }
  }

  type Edge = { a: string, b: string, score: number }
  const edges: Edge[] = []
  
  for (const [, ids] of filteredEntityArticles.entries()) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const idA = ids[i]
        const idB = ids[j]
        if (!canMergeByEventDate([idA], [idB], articlesMap)) continue
        
        let score = 0
        const entsA = articleEntities.get(idA) || new Set()
        const entsB = articleEntities.get(idB) || new Set()
        
        let sharedEntsCount = 0
        for (const e of entsA) {
          if (qualifyingEntities.has(e) && entsB.has(e)) sharedEntsCount++
        }
        
        if (sharedEntsCount >= 2) score += PAIR_SCORE_SHARED_ENTITIES_2
        else if (sharedEntsCount === 1) score += PAIR_SCORE_SHARED_ENTITIES_1
        
        const dateA = articlesMap.get(idA)?.published_at
        const dateB = articlesMap.get(idB)?.published_at
        if (dateA && dateB) {
          const tA = new Date(dateA).getTime()
          const tB = new Date(dateB).getTime()
          if (!Number.isNaN(tA) && !Number.isNaN(tB)) {
            const diffDays = Math.abs(tA - tB) / (1000 * 60 * 60 * 24)
            if (diffDays <= 3) score += PAIR_SCORE_DATE_3DAYS
            else if (diffDays <= 7) score += PAIR_SCORE_DATE_7DAYS
          }
        }
        
        const wordsA = titleWordsMap.get(idA) || new Set()
        const wordsB = titleWordsMap.get(idB) || new Set()
        let hasSharedWord = false
        for (const w of wordsA) {
          if (wordsB.has(w)) {
            hasSharedWord = true
            break
          }
        }
        if (hasSharedWord) score += PAIR_SCORE_TITLE_WORD
        
        if (score >= PAIR_MIN_SCORE) {
          edges.push({ a: idA, b: idB, score })
        }
      }
    }
  }

  const uniqueEdgesMap = new Map<string, Edge>()
  for (const edge of edges) {
    const key = edge.a < edge.b ? `${edge.a}|${edge.b}` : `${edge.b}|${edge.a}`
    if (!uniqueEdgesMap.has(key)) {
      uniqueEdgesMap.set(key, edge)
    }
  }
  const uniqueEdges = Array.from(uniqueEdgesMap.values())

  const parent = new Map<string, string>()
  const find = (i: string): string => {
    if (!parent.has(i)) parent.set(i, i)
    let p = parent.get(i)!
    if (p !== i) {
      p = find(p)
      parent.set(i, p)
    }
    return p
  }
  const union = (i: string, j: string) => {
    const rootI = find(i)
    const rootJ = find(j)
    if (rootI !== rootJ) {
      parent.set(rootI, rootJ)
    }
  }

  for (const edge of uniqueEdges) {
    union(edge.a, edge.b)
  }

  const clusters = new Map<string, string[]>()
  for (const [id, root] of parent.entries()) {
    const r = find(root)
    if (!clusters.has(r)) clusters.set(r, [])
    clusters.get(r)!.push(id)
  }

  const results: { entity: string, articleIds: string[], weightSum: number }[] = []
  
  for (const [, clusterIds] of clusters.entries()) {
    if (clusterIds.length < 2) continue
    
    let finalIds = clusterIds
    if (finalIds.length > 5) {
      const nodeScores = new Map<string, number>()
      for (const id of finalIds) nodeScores.set(id, 0)
      for (const edge of uniqueEdges) {
        if (nodeScores.has(edge.a) && nodeScores.has(edge.b)) {
          nodeScores.set(edge.a, nodeScores.get(edge.a)! + edge.score)
          nodeScores.set(edge.b, nodeScores.get(edge.b)! + edge.score)
        }
      }
      finalIds.sort((a, b) => nodeScores.get(b)! - nodeScores.get(a)!)
      finalIds = finalIds.slice(0, 5)
    }

    const entityCounts = new Map<string, number>()
    for (const id of finalIds) {
      const ents = articleEntities.get(id) || new Set()
      for (const e of ents) {
        if (!qualifyingEntities.has(e)) continue
        entityCounts.set(e, (entityCounts.get(e) || 0) + 1)
      }
    }
    
    let bestEntity = ''
    let maxCount = -1
    for (const [e, count] of entityCounts.entries()) {
      if (count > maxCount) {
        maxCount = count
        bestEntity = e
      }
    }
    
    if (!bestEntity) continue

    const dictEntry = dict.find(e => e.canonical === bestEntity)
    const weight = dictEntry ? dictEntry.weight : 1.0
    const weightSum = finalIds.length * weight

    results.push({
      entity: bestEntity,
      articleIds: finalIds,
      weightSum
    })
  }

  return results
}

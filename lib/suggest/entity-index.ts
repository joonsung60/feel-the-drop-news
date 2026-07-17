import fs from 'node:fs'
import path from 'node:path'
import { EntityDataset, EntityEntry, RawArticle } from './types'

export const ENTITY_DICT_CANDIDATE_PATHS = [
  'lib/edm-entities-v2.json',
  'lib/edm-entities.json',
]

export const ENTITY_HAYSTACK_CONTENT_LIMIT = 500

export function loadEntityDictionary(): EntityEntry[] | null {
  for (const rel of ENTITY_DICT_CANDIDATE_PATHS) {
    const abs = path.join(process.cwd(), rel)
    try {
      const raw = fs.readFileSync(abs, 'utf-8')
      const data = JSON.parse(raw) as EntityDataset & {
        entities?: Array<{ en?: string; aliases_en?: string[]; weight: number }>
      }
      const entries: EntityEntry[] = []
      if (Array.isArray(data.entities)) {
        for (const entity of data.entities) {
          const name = entity?.en
          if (!name) continue
          const surfaces = [name, ...(entity.aliases_en ?? [])]
            .map((s) => (typeof s === 'string' ? s.toLowerCase() : ''))
            .filter((s) => s.length >= 2)
          if (surfaces.length === 0) continue
          entries.push({ canonical: name, surfaces, weight: entity.weight })
        }
        console.log(`[suggest-clusters] entity dict loaded from ${rel}: ${entries.length} entries`)
        return entries
      }
      for (const artist of data.artists_top500_relevance_2024_2025 ?? []) {
        const name = artist?.name
        if (!name) continue
        const surfaces = [name, ...(artist.aliases ?? [])]
          .map((s) => (typeof s === 'string' ? s.toLowerCase() : ''))
          .filter((s) => s.length >= 2)
        if (surfaces.length === 0) continue
        entries.push({ canonical: name, surfaces, weight: artist.weight ?? 0.8 })
      }
      for (const festival of data.major_edm_festivals_worldwide ?? []) {
        const name = festival?.name
        if (!name || name.length < 2) continue
        entries.push({ canonical: name, surfaces: [name.toLowerCase()], weight: 1.0 })
      }
      for (const label of data.edm_labels_key_artists ?? []) {
        const name = label?.name
        if (!name || name.length < 2) continue
        entries.push({ canonical: name, surfaces: [name.toLowerCase()], weight: 0.6 })
      }
      for (const club of data.club_venues ?? []) {
        const name = club?.name
        if (!name) continue
        const surfaces = [name, ...(club.aliases ?? [])]
          .map((s) => (typeof s === 'string' ? s.toLowerCase() : ''))
          .filter((s) => s.length >= 2)
        if (surfaces.length === 0) continue
        entries.push({ canonical: name, surfaces, weight: 0.8 })
      }
      for (const brand of data.equipment_software_brands ?? []) {
        const name = brand?.name
        if (!name) continue
        const surfaces = [name, ...(brand.aliases ?? [])]
          .map((s) => (typeof s === 'string' ? s.toLowerCase() : ''))
          .filter((s) => s.length >= 2)
        if (surfaces.length === 0) continue
        entries.push({ canonical: name, surfaces, weight: 0.6 })
      }
      console.log(`[suggest-clusters] entity dict loaded from ${rel}: ${entries.length} entries`)
      return entries
    } catch {
      // 다음 후보 경로 시도
    }
  }
  return null
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

export function buildEntityIndex(
  articles: RawArticle[],
  dict: EntityEntry[],
): { articleEntities: Map<string, Set<string>>; entityArticles: Map<string, Set<string>> } {
  const articleEntities = new Map<string, Set<string>>()
  const entityArticles = new Map<string, Set<string>>()
  for (const article of articles) {
    const haystack = `${article.title ?? ''}\n${(article.content ?? '').slice(0, ENTITY_HAYSTACK_CONTENT_LIMIT)}`.toLowerCase()
    const matched = new Set<string>()
    for (const entry of dict) {
      for (const surface of entry.surfaces) {
        if (findSurfaceInText(haystack, surface)) {
          matched.add(entry.canonical)
          break
        }
      }
    }
    articleEntities.set(article.id, matched)
    for (const canonical of matched) {
      if (!entityArticles.has(canonical)) entityArticles.set(canonical, new Set())
      entityArticles.get(canonical)!.add(article.id)
    }
  }
  return { articleEntities, entityArticles }
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
  
  // 엔터티당 기사 최대 15개로 제한
  const filteredEntityArticles = new Map<string, string[]>()
  for (const [entity, articleIdSet] of entityArticles.entries()) {
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
        
        let score = 0
        const entsA = articleEntities.get(idA) || new Set()
        const entsB = articleEntities.get(idB) || new Set()
        
        let sharedEntsCount = 0
        for (const e of entsA) {
          if (entsB.has(e)) sharedEntsCount++
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

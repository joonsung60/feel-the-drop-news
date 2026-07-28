import { RawArticle } from './types'

export type ArticleEntityPartition = {
  qualifying: RawArticle[]
  supportingOnly: RawArticle[]
  notMatched: RawArticle[]
}

const EXPLICIT_EDM_PATTERNS = [
  /\belectronic music\b/i,
  /\bdance music\b/i,
  /\bhouse music\b/i,
  /\b(?:techno|trance|dubstep|drum and bass|drum & bass|dnb)\b/i,
  /\bDJ\b/,
  /\belectronic(?:\s+music)?\s+producer\b/i,
  /전자\s*음악|일렉트로닉\s*뮤직|하우스\s*뮤직|테크노|트랜스|덥스텝|드럼\s*앤드\s*베이스|디제이/i,
  /電子音楽|エレクトロニック(?:・|\s*)ミュージック|ハウス(?:・|\s*)ミュージック|テクノ|トランス|ダブステップ|ドラム(?:・|\s*)アンド(?:・|\s*)ベース|DJ/i,
]

export function hasExplicitEdmEvidence(article: RawArticle): boolean {
  const text = `${article.title}\n${(article.content ?? '').slice(0, 500)}`
  return EXPLICIT_EDM_PATTERNS.some((pattern) => pattern.test(text))
}

export function partitionArticlesByEntityRole(
  articles: RawArticle[],
  qualifyingByArticle: Map<string, Set<string>>,
  supportingByArticle: Map<string, Set<string>>,
): ArticleEntityPartition {
  const partition: ArticleEntityPartition = {
    qualifying: [],
    supportingOnly: [],
    notMatched: [],
  }
  for (const article of articles) {
    if ((qualifyingByArticle.get(article.id)?.size ?? 0) > 0) {
      partition.qualifying.push(article)
    } else if ((supportingByArticle.get(article.id)?.size ?? 0) > 0) {
      partition.supportingOnly.push(article)
    } else {
      partition.notMatched.push(article)
    }
  }
  return partition
}

export function selectEligibleLlmInput(
  partition: ArticleEntityPartition,
  maxInput: number,
  noEntityRatioMax: number,
): { input: RawArticle[]; noEntitySelected: RawArticle[] } {
  const qualifying = partition.qualifying.slice(0, maxInput)
  const remainingSlots = maxInput - qualifying.length
  const noEntityLimit = Math.min(remainingSlots, Math.floor(maxInput * noEntityRatioMax))
  const noEntitySelected = partition.notMatched
    .filter(hasExplicitEdmEvidence)
    .slice(0, noEntityLimit)
  return { input: [...qualifying, ...noEntitySelected], noEntitySelected }
}

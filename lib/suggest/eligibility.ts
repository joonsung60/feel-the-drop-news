import { RawArticle } from './types'

export type ArticleEntityPartition = {
  qualifying: RawArticle[]
  danceExperience: RawArticle[]
  supportingOnly: RawArticle[]
  notMatched: RawArticle[]
}

const EXPLICIT_EDM_PATTERNS = [
  /\belectronic music\b/i,
  /\bdance music\b/i,
  /\bhouse music\b/i,
  /\b(?:techno|trance|dubstep|drum and bass|drum & bass|dnb)\b/i,
  /\belectronic(?:\s+music)?\s+producer\b/i,
  /전자\s*음악|일렉트로닉\s*뮤직|하우스\s*뮤직|테크노|트랜스|덥스텝|드럼\s*앤드\s*베이스|디제이/i,
  /電子音楽|エレクトロニック(?:・|\s*)ミュージック|ハウス(?:・|\s*)ミュージック|テクノ|トランス|ダブステップ|ドラム(?:・|\s*)アンド(?:・|\s*)ベース/i,
]
const SYNTH_EVIDENCE_PATTERN = /\b(?:synth|synthesizer|chiptune)\b/i
const DJ_EVIDENCE_PATTERN = /\bDJ(?:s|ing)?\b/i
const NON_EDM_DJ_CONTEXT_PATTERN = /\b(?:hip[- ]?hop|r&b|rap|turntablist)\b/i
const NON_MUSIC_SYNTH_TITLE_PATTERN =
  /\b(?:e-?bike|eMTB|electric (?:mountain )?bike|mountain bike|cycling)\b/i

export function hasExplicitEdmEvidence(article: RawArticle): boolean {
  const text = `${article.title}\n${(article.content ?? '').slice(0, 500)}`
  if (EXPLICIT_EDM_PATTERNS.some((pattern) => pattern.test(text))) return true
  if (
    SYNTH_EVIDENCE_PATTERN.test(text)
    && !NON_MUSIC_SYNTH_TITLE_PATTERN.test(article.title)
  ) return true
  return DJ_EVIDENCE_PATTERN.test(text) && !NON_EDM_DJ_CONTEXT_PATTERN.test(article.title)
}

export function correspondentApprovalPath(article: RawArticle): 'entity' | 'dance_experience' | null {
  const gate = article.facts?.correspondent_gate
  if (gate?.decision !== 'accepted') return null
  return gate.path === 'entity' || gate.path === 'dance_experience' ? gate.path : null
}

export function partitionArticlesByEntityRole(
  articles: RawArticle[],
  qualifyingByArticle: Map<string, Set<string>>,
  supportingByArticle: Map<string, Set<string>>,
): ArticleEntityPartition {
  const partition: ArticleEntityPartition = {
    qualifying: [],
    danceExperience: [],
    supportingOnly: [],
    notMatched: [],
  }
  for (const article of articles) {
    if ((qualifyingByArticle.get(article.id)?.size ?? 0) > 0) {
      partition.qualifying.push(article)
    } else if (correspondentApprovalPath(article) === 'dance_experience') {
      partition.danceExperience.push(article)
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
  const danceExperience = partition.danceExperience.slice(0, maxInput - qualifying.length)
  const remainingSlots = maxInput - qualifying.length - danceExperience.length
  const noEntityLimit = Math.min(remainingSlots, Math.floor(maxInput * noEntityRatioMax))
  const noEntitySelected = partition.notMatched
    .filter(hasExplicitEdmEvidence)
    .slice(0, noEntityLimit)
  return { input: [...qualifying, ...danceExperience, ...noEntitySelected], noEntitySelected }
}

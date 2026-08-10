export type GroundingIssueCode =
  | 'UNSUPPORTED_ENTITY'
  | 'MISMATCHED_ENTITY_PAIR'
  | 'SOURCE_EVIDENCE_UNAVAILABLE'

export type GroundingEntity = {
  id: string
  en: string
  aliases_en: string[]
  ko: string | null
  ko_status: string
  ko_avoid: string[]
}

export type EntitySurfacePolicy = {
  entities: Record<string, {
    role?: string
    contextual_surfaces?: Record<string, {
      before?: string[]
      after?: string[]
      max_gap_chars?: number
    }>
  }>
}

export type GroundingIssue = {
  code: GroundingIssueCode
  message: string
  entity: { id: string; en: string; surface: string } | null
  sourceEvidence: string | null
}

export type GroundingResult = {
  ok: boolean
  issues: GroundingIssue[]
}

export type GroundingSource = { title: string | null; content: string | null }

export function prepareGroundingSources(sources: GroundingSource[]) {
  return sources.map((source) => ({
    title: (source.title ?? '').replace(/\s+/g, ' ').slice(0, 500).trim(),
    content: (source.content ?? '')
      .replace(/[ \t\f\v]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .slice(0, 2500)
      .trim(),
  }))
}

export function buildGroundingEvidence(sources: GroundingSource[]): string {
  return prepareGroundingSources(sources)
    .flatMap((source) => [source.title, source.content])
    .filter(Boolean)
    .join('\n\n')
}

function normalized(text: string): string {
  return text.toLocaleLowerCase('en-US')
}

function findSurfaceInText(text: string, surface: string): boolean {
  if (!surface || surface.length < 2) return false
  let from = 0
  while (true) {
    const index = text.indexOf(surface, from)
    if (index < 0) return false
    const before = index === 0 ? ' ' : text[index - 1]
    const after = index + surface.length >= text.length ? ' ' : text[index + surface.length]
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true
    from = index + 1
  }
}

function findContextualSurfaceInText(
  text: string,
  surface: string,
  beforeContexts: string[],
  afterContexts: string[],
  maxGapChars: number,
): boolean {
  const hasBoundary = (index: number, value: string) => {
    const before = index === 0 ? ' ' : text[index - 1]
    const end = index + value.length
    const after = end >= text.length ? ' ' : text[end]
    return !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)
  }
  const allowedGap = (gap: string) => gap.length <= maxGapChars
    && /^[\s,.:;()'"\[\]\-–—]*$/.test(gap.replace(/\bthe\b/g, ''))
  const contextMatches = (
    contexts: string[],
    contextBeforeSurface: boolean,
    surfaceIndex: number,
    surfaceEnd: number,
  ) => contexts.some((context) => {
    let contextIndex = text.indexOf(context)
    while (contextIndex >= 0) {
      if (hasBoundary(contextIndex, context)) {
        const contextEnd = contextIndex + context.length
        const gap = contextBeforeSurface
          ? text.slice(contextEnd, surfaceIndex)
          : text.slice(surfaceEnd, contextIndex)
        if ((contextBeforeSurface ? contextEnd <= surfaceIndex : contextIndex >= surfaceEnd) && allowedGap(gap)) {
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
    if (hasBoundary(index, surface) && (
      contextMatches(beforeContexts, true, index, end)
      || contextMatches(afterContexts, false, index, end)
    )) return true
    from = index + 1
  }
}

function entityMatchesText(
  text: string,
  entity: GroundingEntity,
  policy: EntitySurfacePolicy,
  surfaces: string[],
): string | null {
  const haystack = normalized(text)
  const contextual = policy.entities[entity.en]?.contextual_surfaces ?? {}

  for (const originalSurface of surfaces.sort((a, b) => b.length - a.length)) {
    const surface = normalized(originalSurface)
    const contextualRule = Object.entries(contextual)
      .find(([candidate]) => normalized(candidate) === surface)?.[1]
    const matched = contextualRule
      ? findContextualSurfaceInText(
          haystack,
          surface,
          (contextualRule.before ?? []).map(normalized),
          (contextualRule.after ?? []).map(normalized),
          contextualRule.max_gap_chars ?? 12,
        )
      : findSurfaceInText(haystack, surface)
    if (matched) return originalSurface
  }
  return null
}

export function findSourceEntities(
  sourceEvidence: string,
  entities: GroundingEntity[],
  policy: EntitySurfacePolicy,
): GroundingEntity[] {
  if (!sourceEvidence.trim()) return []
  return entities.filter((entity) => entityMatchesText(
    sourceEvidence,
    entity,
    policy,
    [entity.en, ...entity.aliases_en],
  ))
}

export function getSourceDisplayNames(
  sourceEvidence: string,
  entities: GroundingEntity[],
  policy: EntitySurfacePolicy,
) {
  return findSourceEntities(sourceEvidence, entities, policy).flatMap((entity) => {
    if (entity.ko_status !== 'established' || !entity.ko?.trim()) return []
    return [{ en: entity.en, ko: entity.ko, koAvoid: entity.ko_avoid }]
  })
}

function sourceExcerpt(sourceEvidence: string, surface: string): string | null {
  const index = normalized(sourceEvidence).indexOf(normalized(surface))
  if (index < 0) return null
  return sourceEvidence.slice(Math.max(0, index - 40), Math.min(sourceEvidence.length, index + surface.length + 40))
}

export function validateArticleGrounding(input: {
  sourceEvidence: string
  title: string
  content: string
  entities: GroundingEntity[]
  policy: EntitySurfacePolicy
}): GroundingResult {
  const { sourceEvidence, title, content, entities, policy } = input
  if (!sourceEvidence.trim()) {
    return {
      ok: false,
      issues: [{
        code: 'SOURCE_EVIDENCE_UNAVAILABLE',
        message: '클러스터에 연결된 원문 제목 또는 본문 근거를 구성할 수 없습니다.',
        entity: null,
        sourceEvidence: null,
      }],
    }
  }

  const allowed = new Map(findSourceEntities(sourceEvidence, entities, policy).map((entity) => [entity.id, entity]))
  const output = `${title}\n${content}`
  const issues: GroundingIssue[] = []

  for (const entity of entities) {
    const surface = entityMatchesText(
      output,
      entity,
      policy,
      [entity.en, ...entity.aliases_en, ...(entity.ko ? [entity.ko] : []), ...entity.ko_avoid],
    )
    if (surface && !allowed.has(entity.id)) {
      issues.push({
        code: 'UNSUPPORTED_ENTITY',
        message: `${entity.en}/${surface}는 원문 근거에서 발견되지 않았습니다.`,
        entity: { id: entity.id, en: entity.en, surface },
        sourceEvidence: null,
      })
    }
  }

  for (const entity of entities) {
    const koreanSurfaces = [entity.ko, ...entity.ko_avoid]
      .filter((surface): surface is string => Boolean(surface))
      .sort((a, b) => b.length - a.length)
    for (const koreanSurface of koreanSurfaces) {
      const pattern = new RegExp(`${koreanSurface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(([^)]+)\\)`, 'g')
      for (const match of output.matchAll(pattern)) {
        const latinSurface = match[1].trim()
        if (!/\p{Script=Latin}/u.test(latinSurface)) continue
        const validLatinSurfaces = [entity.en, ...entity.aliases_en]
        if (!validLatinSurfaces.some((surface) => normalized(surface) === normalized(latinSurface))) {
          issues.push({
            code: 'MISMATCHED_ENTITY_PAIR',
            message: `${koreanSurface}와 괄호 속 ${latinSurface}는 같은 엔티티 표기가 아닙니다.`,
            entity: { id: entity.id, en: entity.en, surface: match[0] },
            sourceEvidence: sourceExcerpt(sourceEvidence, latinSurface),
          })
        }
      }
    }
  }

  return { ok: issues.length === 0, issues }
}

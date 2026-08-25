export type KoreanEditorialTerm = {
  sources: string[]
  preferred: string
  avoid: string[]
  guidance: string
}

export function formatKoreanEditorialTermRules(terms: KoreanEditorialTerm[]): string {
  return terms
    .map(({ sources, preferred, avoid, guidance }) => {
      const avoided = avoid.length > 0 ? ` (${avoid.map((term) => `\"${term}\"`).join(', ')} 사용 금지)` : ''
      return `- ${sources.join(' / ')} → ${preferred}: ${guidance}${avoided}`
    })
    .join('\n')
}

export function applyKoreanEditorialTermCorrections(
  text: string,
  terms: KoreanEditorialTerm[]
): string {
  let result = text
  const corrections = terms
    .flatMap(({ preferred, avoid }) => avoid
      .filter((term) => term && term !== preferred)
      .map((term) => [term, preferred] as const))
    .sort((a, b) => b[0].length - a[0].length)

  for (const [from, to] of corrections) {
    result = result.replaceAll(from, to)
  }
  return result
}

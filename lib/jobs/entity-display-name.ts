export type EntityDisplayName = {
  en: string
  ko: string
  koAvoid: string[]
}

type EntityDictionaryEntry = {
  en: string
  ko: string | null
  ko_status: string
  ko_avoid: string[]
}

export function getEstablishedEntityDisplayNames(
  entities: EntityDictionaryEntry[]
): EntityDisplayName[] {
  return entities.flatMap((entity) => {
    if (entity.ko_status !== 'established' || typeof entity.ko !== 'string' || !entity.ko.trim()) {
      return []
    }
    return [{ en: entity.en, ko: entity.ko, koAvoid: entity.ko_avoid }]
  })
}

function isHighRiskAbbreviation(en: string): boolean {
  if (en.length >= 4) return false
  const letters = [...en].filter((char) => /[A-Za-z]/.test(char))
  const allLettersUppercase = letters.length > 0
    && letters.every((char) => char === char.toUpperCase())
  const onlyNumbersOrSymbols = letters.length === 0
  return allLettersUppercase || onlyNumbersOrSymbols
}

function replaceWithAsciiBoundaries(text: string, from: string, to: string): string {
  let result = ''
  let copiedThrough = 0
  let searchFrom = 0

  while (searchFrom < text.length) {
    const index = text.indexOf(from, searchFrom)
    if (index < 0) break

    const before = index === 0 ? '' : text[index - 1]
    const afterIndex = index + from.length
    const after = afterIndex >= text.length ? '' : text[afterIndex]
    if (!/[A-Za-z0-9]/.test(before) && !/[A-Za-z0-9]/.test(after)) {
      result += text.slice(copiedThrough, index) + to
      copiedThrough = afterIndex
      searchFrom = afterIndex
    } else {
      searchFrom = index + 1
    }
  }

  return result + text.slice(copiedThrough)
}

function koreanAvoidCorrections(displayNames: EntityDisplayName[]): ReadonlyArray<readonly [string, string]> {
  return displayNames
    .flatMap(({ ko, koAvoid }) => koAvoid
      .filter((avoid) => avoid && avoid !== ko)
      .map((avoid) => [avoid, ko] as const))
    .sort((a, b) => b[0].length - a[0].length)
}

export function applyKoreanAvoidCorrections(
  text: string,
  displayNames: EntityDisplayName[]
): string {
  let result = text
  for (const [avoid, ko] of koreanAvoidCorrections(displayNames)) {
    result = replaceWithAsciiBoundaries(result, avoid, ko)
  }
  return result
}

export function applyDisplayNameMappingToTitle(
  text: string,
  displayNames: EntityDisplayName[]
): string {
  let result = text
  const replacements = displayNames
    .filter(({ en, ko }) => en !== ko && !isHighRiskAbbreviation(en))
    .map(({ en, ko }) => [en, ko] as const)
    .sort((a, b) => b[0].length - a[0].length)

  for (const [en, ko] of replacements) {
    result = replaceWithAsciiBoundaries(result, en, ko)
  }
  return applyKoreanAvoidCorrections(result, displayNames)
}

export type Suggest2Decision = {
  approved: boolean
  topic: string
  keywords: string[]
  reason: string
}

export type Suggest2DecisionResult =
  | { outcome: 'approved' | 'rejected'; decision: Suggest2Decision }
  | { outcome: 'failed'; error: 'json_parse' | 'schema' }

function parseJsonObject(responseText: string): unknown {
  try {
    return JSON.parse(responseText)
  } catch {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('JSON object not found')
    return JSON.parse(jsonMatch[0])
  }
}

export function parseSuggest2Decision(responseText: string): Suggest2DecisionResult {
  let value: unknown
  try {
    value = parseJsonObject(responseText)
  } catch {
    return { outcome: 'failed', error: 'json_parse' }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { outcome: 'failed', error: 'schema' }
  }
  const record = value as Record<string, unknown>
  if (
    typeof record.approved !== 'boolean'
    || typeof record.topic !== 'string'
    || !Array.isArray(record.keywords)
    || !record.keywords.every((keyword) => typeof keyword === 'string')
    || typeof record.reason !== 'string'
    || (record.approved && record.topic.trim().length === 0)
    || (!record.approved && record.reason.trim().length === 0)
  ) {
    return { outcome: 'failed', error: 'schema' }
  }
  const decision: Suggest2Decision = {
    approved: record.approved,
    topic: record.topic,
    keywords: record.keywords,
    reason: record.reason,
  }
  return { outcome: decision.approved ? 'approved' : 'rejected', decision }
}

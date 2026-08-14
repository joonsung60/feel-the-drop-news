export const SUGGEST2_DISABLED_BODY = {
  status: 'disabled' as const,
  code: 'suggest2_rework' as const,
  message: 'Suggest 2는 재설계 중이라 임시 비활성화되어 있습니다. Suggest 1을 이용해 주세요.',
}

export function isSuggest2Enabled(value = process.env.SUGGEST2_ENABLED): boolean {
  return value === 'true'
}

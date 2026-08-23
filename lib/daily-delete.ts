const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export function isValidDailyDeleteRequest(runId: string, displayOrder: number): boolean {
  return UUID_PATTERN.test(runId) && Number.isInteger(displayOrder) && displayOrder > 0
}

export function validateDailyDeleteState(input: {
  runStatus: string | null
  itemStatus: string | null
  articleId: string | null
  articlePublished: boolean | null
}): string | null {
  if (input.runStatus !== 'succeeded' && input.runStatus !== 'partial') {
    return '완료된 일일 실행을 찾을 수 없습니다.'
  }
  if (input.itemStatus !== 'done' || !input.articleId) {
    return '해당 실행의 삭제 가능한 기사 번호가 아닙니다.'
  }
  if (input.articlePublished !== false) return '게시된 기사이거나 기사를 찾을 수 없습니다.'
  return null
}

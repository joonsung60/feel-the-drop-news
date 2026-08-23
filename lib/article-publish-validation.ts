export type PublishValidationError = {
  status: number
  body: { code: string; error: string }
}

export function validateMinimumPublishContent(content: string): PublishValidationError | null {
  if (content.trim().length >= 80) return null
  return {
    status: 422,
    body: {
      code: 'ARTICLE_CONTENT_TOO_SHORT',
      error: '본문은 앞뒤 공백을 제거한 뒤 80자 이상이어야 게시할 수 있습니다.',
    },
  }
}

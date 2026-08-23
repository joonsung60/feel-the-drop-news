export const ARTICLE_PREVIEW_LENGTH = 500

export type ArticleCardInput = {
  title: unknown
  content: unknown
  displayOrder?: number | null
}

export function formatArticlePreview(content: unknown): string {
  if (typeof content !== 'string') return ''
  const trimmed = content.trim()
  return trimmed.length <= ARTICLE_PREVIEW_LENGTH
    ? trimmed
    : `${trimmed.slice(0, ARTICLE_PREVIEW_LENGTH)}...`
}

export function formatArticleMessage(input: ArticleCardInput): string {
  const title = typeof input.title === 'string' && input.title.trim()
    ? input.title.trim()
    : '제목 없음'
  const prefix = Number.isInteger(input.displayOrder) ? `${input.displayOrder}. ` : ''
  const header = `${prefix}${title}`
  const preview = formatArticlePreview(input.content)
  return preview ? `${header}\n\n${preview}` : header
}

export function buildArticleCardReplyMarkup(publishData: string, deleteData: string) {
  return {
    inline_keyboard: [[
      { text: '게시', callback_data: publishData },
      { text: '삭제', callback_data: deleteData },
    ]],
  }
}

export function buildArticleCardMessage(
  input: ArticleCardInput,
  publishData: string,
  deleteData: string,
) {
  return {
    text: formatArticleMessage(input),
    replyMarkup: buildArticleCardReplyMarkup(publishData, deleteData),
  }
}

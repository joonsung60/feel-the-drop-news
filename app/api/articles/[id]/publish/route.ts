import { NextRequest, NextResponse } from 'next/server'
import { executePreparedPublish, isPublishError, prepareArticlePublish } from '@/lib/publish-service'

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
  try {
    const prepared = await prepareArticlePublish(id)
    if (isPublishError(prepared)) return NextResponse.json(prepared.body, { status: prepared.status })
    const result = await executePreparedPublish(prepared, true)
    if (result.type === 'grounding_failed') {
      return NextResponse.json({ code: result.code, error: 'grounding 선검증 결과가 변경되었습니다.' }, { status: 409 })
    }
    if (result.type === 'article_changed') return NextResponse.json({ code: result.code, error: '검증 이후 기사 내용이 변경되었습니다.' }, { status: 409 })
    if (result.type === 'article_update_failed') return NextResponse.json({ error: result.error }, { status: 500 })
    if (result.type === 'raw_article_update_failed') return NextResponse.json({ article: result.article, rawArticleUpdateError: result.error }, { status: 500 })
    return NextResponse.json({ article: result.article })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

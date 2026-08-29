import { NextRequest, NextResponse } from 'next/server'
import { authorizeAdminRequest } from '@/lib/admin-api-auth'
import { triggerDeployHook } from '@/lib/deploy-hook'
import { isValidArticleId } from '@/lib/homepage-hero-mutation'
import { isHomepagePlacement } from '@/lib/homepage-selection'
import { clearAdminHomepagePlacement, setAdminHomepagePlacement } from '@/lib/homepage-editorial-admin'
import { applyEditorialMutation, editorialMutationError } from '@/lib/homepage-editorial-mutation'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ placement: string }> }) {
  const authorization = await authorizeAdminRequest(request)
  if (!authorization.ok) return authorization.response
  const { placement } = await params
  const body = await request.json().catch(() => null)
  if (!isHomepagePlacement(placement) || !body || !isValidArticleId(body.articleId)) {
    return NextResponse.json({ error: '올바른 placement와 articleId가 필요합니다.' }, { status: 400 })
  }
  return run(() => setAdminHomepagePlacement(placement, body.articleId))
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ placement: string }> }) {
  const authorization = await authorizeAdminRequest(request)
  if (!authorization.ok) return authorization.response
  const { placement } = await params
  if (!isHomepagePlacement(placement)) return NextResponse.json({ error: '지원되지 않는 placement입니다.' }, { status: 400 })
  return run(() => clearAdminHomepagePlacement(placement))
}

async function run(mutate: Parameters<typeof applyEditorialMutation>[0]) {
  try {
    const value = await applyEditorialMutation(mutate, triggerDeployHook)
    const failure = editorialMutationError(value.mutation.result)
    if (failure) return NextResponse.json({ error: failure.error }, { status: failure.status })
    return NextResponse.json(value)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

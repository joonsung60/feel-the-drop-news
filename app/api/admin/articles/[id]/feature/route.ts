import { NextRequest, NextResponse } from 'next/server'
import { authorizeAdminRequest } from '@/lib/admin-api-auth'
import { triggerDeployHook } from '@/lib/deploy-hook'
import { isValidArticleId } from '@/lib/homepage-hero-mutation'
import { isHomepagePlacement } from '@/lib/homepage-selection'
import { removeAdminArticleFeature, setAdminArticleFeature } from '@/lib/homepage-editorial-admin'
import { applyEditorialMutation, editorialMutationError } from '@/lib/homepage-editorial-mutation'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeAdminRequest(request)
  if (!authorization.ok) return authorization.response
  const { id } = await params
  if (!isValidArticleId(id)) return NextResponse.json({ error: '올바른 article ID가 필요합니다.' }, { status: 400 })
  const body = await request.json().catch(() => null)
  if (!body || (body.placement !== null && body.placement !== undefined && !isHomepagePlacement(body.placement))) {
    return NextResponse.json({ error: 'placement는 null 또는 지원되는 홈페이지 슬롯이어야 합니다.' }, { status: 400 })
  }
  return run(() => setAdminArticleFeature(id, body.placement ?? null))
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeAdminRequest(request)
  if (!authorization.ok) return authorization.response
  const { id } = await params
  if (!isValidArticleId(id)) return NextResponse.json({ error: '올바른 article ID가 필요합니다.' }, { status: 400 })
  return run(() => removeAdminArticleFeature(id))
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

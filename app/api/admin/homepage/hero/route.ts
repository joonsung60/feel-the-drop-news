import { NextRequest, NextResponse } from 'next/server'
import { authorizeAdminRequest } from '@/lib/admin-api-auth'
import { triggerDeployHook } from '@/lib/deploy-hook'
import {
  applyHeroMutation,
  heroMutationError,
  isValidArticleId,
} from '@/lib/homepage-hero-mutation'
import {
  loadAdminHomepageHero,
  setAdminHomepageHero,
} from '@/lib/homepage-placement-admin'

export async function GET(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request)
  if (!authorization.ok) return authorization.response

  try {
    return NextResponse.json({ hero: await loadAdminHomepageHero() })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request)
  if (!authorization.ok) return authorization.response

  const body = await request.json().catch(() => null)
  if (!body || !isValidArticleId(body.articleId)) {
    return NextResponse.json({ error: '올바른 articleId가 필요합니다.' }, { status: 400 })
  }

  return mutateHero(body.articleId)
}

export async function DELETE(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request)
  if (!authorization.ok) return authorization.response
  return mutateHero(null)
}

async function mutateHero(articleId: string | null) {
  try {
    const result = await applyHeroMutation(articleId, {
      setHero: setAdminHomepageHero,
      triggerDeploy: triggerDeployHook,
    })

    const mutationError = heroMutationError(result.mutation.result)
    if (mutationError) {
      return NextResponse.json({ error: mutationError.error }, { status: mutationError.status })
    }

    return NextResponse.json({
      hero: result.mutation.articleId
        ? {
            articleId: result.mutation.articleId,
            updatedAt: result.mutation.updatedAt,
            effective: true,
          }
        : null,
      changed: result.mutation.changed,
      deploy: result.deploy,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

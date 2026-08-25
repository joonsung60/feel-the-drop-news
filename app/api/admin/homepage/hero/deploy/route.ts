import { NextRequest, NextResponse } from 'next/server'
import { authorizeAdminRequest } from '@/lib/admin-api-auth'
import { triggerDeployHook } from '@/lib/deploy-hook'
import { toHeroDeployState } from '@/lib/homepage-hero-mutation'

export async function POST(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request)
  if (!authorization.ok) return authorization.response

  return NextResponse.json({ deploy: toHeroDeployState(await triggerDeployHook()) })
}


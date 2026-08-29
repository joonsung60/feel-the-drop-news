import { NextRequest, NextResponse } from 'next/server'
import { authorizeAdminRequest } from '@/lib/admin-api-auth'
import { triggerDeployHook } from '@/lib/deploy-hook'
import { toHomepageDeployState } from '@/lib/homepage-editorial-mutation'

export async function POST(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request)
  if (!authorization.ok) return authorization.response
  return NextResponse.json({ deploy: toHomepageDeployState(await triggerDeployHook()) })
}

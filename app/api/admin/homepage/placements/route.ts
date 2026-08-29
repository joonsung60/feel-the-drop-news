import { NextRequest, NextResponse } from 'next/server'
import { authorizeAdminRequest } from '@/lib/admin-api-auth'
import { loadAdminHomepageEditorialState } from '@/lib/homepage-editorial-admin'

export async function GET(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request)
  if (!authorization.ok) return authorization.response
  try {
    return NextResponse.json(await loadAdminHomepageEditorialState())
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

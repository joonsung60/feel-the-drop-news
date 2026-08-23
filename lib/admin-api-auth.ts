import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE_NAME, verifyAdminSession } from '@/lib/admin-session'

export type AdminAuthorizationResult =
  | { ok: true }
  | { ok: false; response: NextResponse }

function requestOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host')
  const host = forwardedHost ?? request.headers.get('host')
  const forwardedProto = request.headers.get('x-forwarded-proto')
  if (host) return `${forwardedProto ?? request.nextUrl.protocol.replace(':', '')}://${host}`
  return request.nextUrl.origin
}

export function isSameOriginAdminRequest(request: NextRequest): boolean {
  const source = request.headers.get('origin') ?? request.headers.get('referer')
  if (!source) return request.method === 'GET' || request.method === 'HEAD'

  try {
    return new URL(source).origin === requestOrigin(request)
  } catch {
    return false
  }
}

export async function authorizeAdminRequest(
  request: NextRequest
): Promise<AdminAuthorizationResult> {
  const password = process.env.ADMIN_PASSWORD
  if (!password) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'ADMIN_PASSWORD is not configured' },
        { status: 500 }
      ),
    }
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!token || !(await verifyAdminSession(token, password))) {
    return {
      ok: false,
      response: NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 }),
    }
  }

  if (!isSameOriginAdminRequest(request)) {
    return {
      ok: false,
      response: NextResponse.json({ error: '허용되지 않은 요청 출처입니다.' }, { status: 403 }),
    }
  }

  return { ok: true }
}

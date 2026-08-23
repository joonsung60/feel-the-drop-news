import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { authorizeAdminRequest } from '@/lib/admin-api-auth'
import { SESSION_COOKIE_NAME, signAdminSession } from '@/lib/admin-session'

const PASSWORD = 'preview-test-password'

test('admin API rejects a request without a session', async () => {
  const previous = process.env.ADMIN_PASSWORD
  process.env.ADMIN_PASSWORD = PASSWORD
  try {
    const result = await authorizeAdminRequest(
      new NextRequest('https://cms.example.com/api/admin/articles/id/preview')
    )
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.response.status, 401)
  } finally {
    if (previous === undefined) delete process.env.ADMIN_PASSWORD
    else process.env.ADMIN_PASSWORD = previous
  }
})

test('admin API accepts a valid same-origin session', async () => {
  const previous = process.env.ADMIN_PASSWORD
  process.env.ADMIN_PASSWORD = PASSWORD
  try {
    const token = await signAdminSession(PASSWORD)
    const result = await authorizeAdminRequest(
      new NextRequest('https://cms.example.com/api/admin/articles/id/preview', {
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${token}`,
          origin: 'https://cms.example.com',
        },
      })
    )
    assert.equal(result.ok, true)
  } finally {
    if (previous === undefined) delete process.env.ADMIN_PASSWORD
    else process.env.ADMIN_PASSWORD = previous
  }
})

test('admin API rejects a cross-origin request with a valid session', async () => {
  const previous = process.env.ADMIN_PASSWORD
  process.env.ADMIN_PASSWORD = PASSWORD
  try {
    const token = await signAdminSession(PASSWORD)
    const result = await authorizeAdminRequest(
      new NextRequest('https://cms.example.com/api/admin/articles/id/preview', {
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${token}`,
          origin: 'https://attacker.example',
        },
      })
    )
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.response.status, 403)
  } finally {
    if (previous === undefined) delete process.env.ADMIN_PASSWORD
    else process.env.ADMIN_PASSWORD = previous
  }
})

test('admin mutation accepts a valid same-origin POST', async () => {
  const previous = process.env.ADMIN_PASSWORD
  process.env.ADMIN_PASSWORD = PASSWORD
  try {
    const token = await signAdminSession(PASSWORD)
    const result = await authorizeAdminRequest(new NextRequest('https://cms.example.com/api/admin/articles', {
      method: 'POST',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}`, origin: 'https://cms.example.com' },
    }))
    assert.equal(result.ok, true)
  } finally {
    if (previous === undefined) delete process.env.ADMIN_PASSWORD
    else process.env.ADMIN_PASSWORD = previous
  }
})

test('admin mutation rejects missing source and cross-origin PATCH', async () => {
  const previous = process.env.ADMIN_PASSWORD
  process.env.ADMIN_PASSWORD = PASSWORD
  try {
    const token = await signAdminSession(PASSWORD)
    const cookie = `${SESSION_COOKIE_NAME}=${token}`
    const missing = await authorizeAdminRequest(new NextRequest('https://cms.example.com/api/admin/articles', { method: 'POST', headers: { cookie } }))
    assert.equal(missing.ok, false)
    if (!missing.ok) assert.equal(missing.response.status, 403)
    const crossOrigin = await authorizeAdminRequest(new NextRequest('https://cms.example.com/api/admin/articles/id', {
      method: 'PATCH', headers: { cookie, origin: 'https://attacker.example' },
    }))
    assert.equal(crossOrigin.ok, false)
    if (!crossOrigin.ok) assert.equal(crossOrigin.response.status, 403)
  } finally {
    if (previous === undefined) delete process.env.ADMIN_PASSWORD
    else process.env.ADMIN_PASSWORD = previous
  }
})

test('admin mutation rejects an invalid session', async () => {
  const previous = process.env.ADMIN_PASSWORD
  process.env.ADMIN_PASSWORD = PASSWORD
  try {
    const result = await authorizeAdminRequest(new NextRequest('https://cms.example.com/api/admin/articles', {
      method: 'POST', headers: { cookie: `${SESSION_COOKIE_NAME}=invalid`, origin: 'https://cms.example.com' },
    }))
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.response.status, 401)
  } finally {
    if (previous === undefined) delete process.env.ADMIN_PASSWORD
    else process.env.ADMIN_PASSWORD = previous
  }
})

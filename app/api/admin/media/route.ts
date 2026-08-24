import { NextRequest, NextResponse } from 'next/server'
import { authorizeAdminRequest } from '@/lib/admin-api-auth'
import {
  createEditorialStoragePath,
  detectEditorialImageMime,
  EDITORIAL_MEDIA_BUCKET,
  isManagedEditorialPath,
  MAX_EDITORIAL_IMAGE_BYTES,
} from '@/lib/editorial-media'
import { cleanupUnreferencedEditorialMedia } from '@/lib/editorial-media-cleanup'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request)
  if (!authorization.ok) return authorization.response
  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: '이미지 파일이 필요합니다.' }, { status: 400 })
  if (file.size <= 0 || file.size > MAX_EDITORIAL_IMAGE_BYTES) {
    return NextResponse.json({ error: '이미지는 8MB 이하여야 합니다.', code: 'IMAGE_SIZE_INVALID' }, { status: 413 })
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  const detectedMime = detectEditorialImageMime(bytes)
  if (!detectedMime || file.type !== detectedMime) {
    return NextResponse.json({ error: 'JPEG, PNG, WebP 원본 파일만 업로드할 수 있습니다.', code: 'IMAGE_SIGNATURE_INVALID' }, { status: 415 })
  }
  const storagePath = createEditorialStoragePath(detectedMime)
  const { error } = await supabase.storage.from(EDITORIAL_MEDIA_BUCKET).upload(storagePath, bytes, {
    contentType: detectedMime,
    cacheControl: '31536000',
    upsert: false,
  })
  if (error) return NextResponse.json({ error: `이미지 업로드 실패: ${error.message}`, code: 'STORAGE_UPLOAD_FAILED' }, { status: 502 })
  const { data } = supabase.storage.from(EDITORIAL_MEDIA_BUCKET).getPublicUrl(storagePath)
  return NextResponse.json({ publicUrl: data.publicUrl, storagePath, mimeType: detectedMime, size: file.size }, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request)
  if (!authorization.ok) return authorization.response
  const body = await request.json().catch(() => null) as { storagePath?: unknown } | null
  if (!isManagedEditorialPath(body?.storagePath)) {
    return NextResponse.json({ error: '삭제할 수 없는 관리 경로입니다.', code: 'MEDIA_PATH_FORBIDDEN' }, { status: 400 })
  }
  const path = body.storagePath
  const result = await cleanupUnreferencedEditorialMedia([path])
  if (result.referenced.includes(path)) {
    return NextResponse.json({ error: '기사에서 사용 중인 이미지는 삭제할 수 없습니다.', code: 'MEDIA_IN_USE' }, { status: 409 })
  }
  if (result.error) {
    return NextResponse.json({ error: `이미지 참조 확인 또는 삭제 실패: ${result.error}`, code: 'MEDIA_CLEANUP_FAILED' }, { status: 502 })
  }
  if (!result.deleted.includes(path)) {
    return NextResponse.json({ error: '이미지를 삭제하지 못했습니다.', code: 'STORAGE_DELETE_FAILED' }, { status: 502 })
  }
  return NextResponse.json({ deleted: true, storagePath: path })
}

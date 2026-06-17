import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { triggerDeployHook } from '@/lib/deploy-hook'

export const runtime = 'nodejs'

const BUCKET_NAME = 'image-sources'
const MAX_BASE64_LENGTH = 14_000_000

type ImageUpdateRequest = {
  imageBase64?: string
  mimeType?: string
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseImagePayload(imageBase64: string): {
  base64: string
  mimeTypeFromPayload: string | null
} {
  const dataUrlMatch = imageBase64.match(/^data:(image\/(?:jpeg|jpg|png));base64,(.+)$/i)
  if (dataUrlMatch) {
    return {
      base64: dataUrlMatch[2],
      mimeTypeFromPayload: dataUrlMatch[1].toLowerCase().replace('image/jpg', 'image/jpeg'),
    }
  }

  return {
    base64: imageBase64.replace(/\s+/g, ''),
    mimeTypeFromPayload: null,
  }
}

function extensionForMime(mimeType: string): string {
  return mimeType === 'image/png' ? 'png' : 'jpg'
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json().catch(() => ({})) as ImageUpdateRequest

  if (!id) {
    return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
  }

  if (!body.imageBase64 || typeof body.imageBase64 !== 'string') {
    return NextResponse.json({ error: 'imageBase64가 필요합니다.' }, { status: 400 })
  }

  if (body.imageBase64.length > MAX_BASE64_LENGTH) {
    return NextResponse.json({ error: '이미지 파일이 너무 큽니다.' }, { status: 400 })
  }

  const { data: existing, error: fetchError } = await supabase
    .from('articles')
    .select('id, published')
    .eq('id', id)
    .maybeSingle()

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  if (!existing) {
    return NextResponse.json({ error: '기사를 찾을 수 없습니다.' }, { status: 404 })
  }

  const { base64, mimeTypeFromPayload } = parseImagePayload(body.imageBase64)
  const mimeType = (mimeTypeFromPayload ?? normalizeOptionalText(body.mimeType) ?? 'image/jpeg')
    .toLowerCase()
    .replace('image/jpg', 'image/jpeg')

  if (!['image/jpeg', 'image/png'].includes(mimeType)) {
    return NextResponse.json({ error: 'jpg/png 이미지만 지원합니다.' }, { status: 400 })
  }

  const bytes = Buffer.from(base64, 'base64')
  if (bytes.length === 0) {
    return NextResponse.json({ error: '이미지 데이터를 읽지 못했습니다.' }, { status: 400 })
  }

  const ext = extensionForMime(mimeType)
  const imagePath = `${new Date().getFullYear()}/articles/${id}-${Date.now()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(imagePath, bytes, {
      contentType: mimeType,
      upsert: false,
    })

  if (uploadError) {
    return NextResponse.json(
      { error: `이미지 업로드 실패: ${uploadError.message}` },
      { status: 500 }
    )
  }

  const { data: publicUrlData } = supabase.storage
    .from(BUCKET_NAME)
    .getPublicUrl(imagePath)

  const { data: article, error: updateError } = await supabase
    .from('articles')
    .update({
      image_url: publicUrlData.publicUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('id, title, content, published, published_at, created_at, updated_at, cluster_id, image_url, slug, category, genre')
    .maybeSingle()

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  if (existing.published) {
    await triggerDeployHook()
  }

  return NextResponse.json({ article })
}

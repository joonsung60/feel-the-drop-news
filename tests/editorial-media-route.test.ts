import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('editorial media route uses authenticated same-origin multipart and guarded managed deletion', () => {
  const source = readFileSync('app/api/admin/media/route.ts', 'utf8')
  assert.match(source, /authorizeAdminRequest\(request\)/)
  assert.match(source, /request\.formData\(\)/)
  assert.match(source, /detectEditorialImageMime/)
  assert.match(source, /MAX_EDITORIAL_IMAGE_BYTES/)
  assert.match(source, /isManagedEditorialPath/)
  assert.match(source, /code: 'MEDIA_IN_USE'/)
  assert.match(source, /code: 'STORAGE_UPLOAD_FAILED'/)
})

test('editor exposes blank article and positional managed image controls', () => {
  const editor = readFileSync('components/EditorialArticleEditor.tsx', 'utf8')
  const admin = readFileSync('app/admin/page.tsx', 'utf8')
  assert.match(admin, /백지에서 새 기사 작성/)
  assert.match(editor, /문서 맨 처음에 이미지 추가/)
  assert.match(editor, /위에 이미지/)
  assert.match(editor, /아래에 이미지/)
  assert.match(editor, /image\/webp/)
  assert.match(editor, /이미지 caption/)
  assert.match(editor, /이미지 credit/)
  assert.match(editor, /uploadSession\.current\.reconcile/)
  assert.match(editor, /uploadSession\.current\.finishSave/)
  assert.match(editor, /uploadSession\.current\.abandon/)
})

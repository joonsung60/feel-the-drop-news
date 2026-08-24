import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('cover migration is additive, nullable, constrained, and enables WebP in the reused bucket', () => {
  const sql = readFileSync('supabase/migrations/20260823154320_add_article_cover_image_mode.sql', 'utf8')
  assert.match(sql, /add column cover_image_mode text null/)
  assert.match(sql, /add column cover_image_path text null/)
  assert.match(sql, /cover_image_mode is null/)
  assert.match(sql, /'auto', 'none', 'custom'/)
  assert.match(sql, /where id = 'image-sources'/)
  assert.match(sql, /'image\/webp'/)
  assert.doesNotMatch(sql, /update public\.articles/i)
})

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('cover body visibility migration is additive, nullable, and does not backfill articles', () => {
  const sql = readFileSync('supabase/migrations/20260824143846_add_article_cover_body_visibility.sql', 'utf8')
  assert.match(sql, /add column show_cover_in_article boolean null/)
  assert.doesNotMatch(sql, /update public\.articles/i)
  assert.doesNotMatch(sql, /default/i)
})

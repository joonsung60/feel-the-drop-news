import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const sql = readFileSync(path.resolve('supabase/migrations/20260825145032_feature_collection_homepage_placements.sql'), 'utf8')

test('Feature schema, 정렬 index, 네 singleton과 Feature-only unique FK를 정의한다', () => {
  assert.match(sql, /create table public\.article_features/)
  assert.match(sql, /featured_at desc, article_id asc/)
  assert.match(sql, /references public\.article_features\(article_id\)[\s\S]*on delete set null/)
  assert.match(sql, /unique \(article_id\)/)
  for (const placement of ['homepage_hero', 'homepage_featured_1', 'homepage_featured_2', 'homepage_featured_3']) assert.match(sql, new RegExp(placement))
})

test('published pinned Hero를 FK 전환 전에 Feature로 편입하고 기존 placement를 변경하지 않는다', () => {
  const backfill = sql.indexOf('insert into public.article_features')
  const fk = sql.indexOf('references public.article_features(article_id)')
  assert.ok(backfill >= 0 && backfill < fk)
  assert.match(sql, /hp\.placement = 'homepage_hero'[\s\S]*article\.published is true/)
  assert.doesNotMatch(sql.slice(backfill, fk), /update public\.homepage_placements/)
})

test('RLS, 최소 GRANT, invoker RPC와 unpublish Feature 삭제를 정의한다', () => {
  assert.match(sql, /enable row level security/)
  assert.match(sql, /grant select on table public\.article_features to anon/)
  assert.match(sql, /grant select, insert, update, delete on table public\.article_features to service_role/)
  assert.doesNotMatch(sql, /grant all/i)
  assert.equal((sql.match(/security invoker/g) ?? []).length, 6)
  assert.match(sql, /old\.published is true and new\.published is false[\s\S]*delete from public\.article_features/)
})

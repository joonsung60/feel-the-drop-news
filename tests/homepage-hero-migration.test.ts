import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const migration = readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20260825000000_primary_hero_pin.sql'),
  'utf8'
)

test('migration은 별도 singleton placement와 nullable UUID FK만 추가한다', () => {
  assert.match(migration, /create table public\.homepage_placements/)
  assert.match(migration, /placement text primary key/)
  assert.match(migration, /check \(placement in \('homepage_hero'\)\)/)
  assert.match(migration, /article_id uuid references public\.articles\(id\) on delete set null/)
  assert.match(migration, /values \('homepage_hero', null\)/)
  assert.doesNotMatch(migration, /alter table public\.articles\s+add column/i)
})

test('anon은 SELECT만, service_role은 SELECT와 UPDATE만 받는다', () => {
  assert.match(migration, /enable row level security/)
  assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated, service_role/)
  assert.match(migration, /grant select on table public\.homepage_placements to anon/)
  assert.match(migration, /grant select, update on table public\.homepage_placements to service_role/)
  assert.doesNotMatch(migration, /grant all/i)
})

test('mutation RPC는 invoker이고 공개 실행 권한을 제거한다', () => {
  assert.match(migration, /function public\.set_homepage_hero\(requested_article_id uuid\)/)
  assert.match(migration, /security invoker/)
  assert.match(migration, /for share/)
  assert.match(migration, /homepage_hero placement row is missing/)
  assert.match(migration, /revoke execute[\s\S]*from public, anon, authenticated/)
  assert.match(migration, /grant execute[\s\S]*to service_role/)
  assert.match(
    migration,
    /clear_homepage_hero_on_article_unpublish\(\)[\s\S]*from public, anon, authenticated, service_role/
  )
  assert.doesNotMatch(migration, /security definer/i)
})

test('true에서 false로 게시 취소할 때만 같은 transaction에서 Hero를 비운다', () => {
  assert.match(migration, /after update of published on public\.articles/)
  assert.match(migration, /old\.published is true and new\.published is false/)
  assert.match(migration, /set article_id = null/)
  assert.doesNotMatch(migration, /new\.published is true[\s\S]*set article_id/i)
})

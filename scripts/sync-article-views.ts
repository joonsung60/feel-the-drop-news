import { loadEnvConfig } from '@next/env'

loadEnvConfig(process.cwd())

async function main() {
  const [{ fetchPageViews }, { parseArticleSlug, syncArticleViews }, { supabaseAdmin }] = await Promise.all([
    import('../lib/cloudflare-analytics'),
    import('../lib/article-views'),
    import('../lib/supabase-admin'),
  ])
  const pageViews = await fetchPageViews()
  const topTen = pageViews.slice(0, 10)

  console.log('CF raw requestPath 목록 (상위 10개)')
  console.table(topTen.map(({ path, views }) => ({ requestPath: path, views })))
  console.log('slug 파싱 결과')
  console.table(topTen.map(({ path, views }) => ({
    requestPath: path,
    slug: parseArticleSlug(path),
    views,
  })))

  const syncResult = await syncArticleViews()
  console.log('동기화 결과:', syncResult)
  const { data, error } = await supabaseAdmin
    .from('article_views')
    .select('slug, views_30d')
    .order('views_30d', { ascending: false })
    .limit(10)

  if (error) {
    console.error('article_views 확인 실패:', error)
    process.exitCode = 1
    return
  }
  console.log('upsert 후 article_views 상위 10개')
  console.table(data ?? [])
}

main().catch((error) => {
  console.error('조회수 검증 스크립트 실패:', error)
  process.exitCode = 1
})

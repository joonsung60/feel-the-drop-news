import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  correspondentIngestionSource,
  createIngestionRunId,
  directUrlIngestionSource,
  rssIngestionSource,
} from '../lib/ingestion-run'
import { resolvePoolEvaluationCompletion } from '../lib/suggest/evaluation-completion'

const root = process.cwd()

test('ingestion helpers produce UUID runs and stable source keys', () => {
  const first = createIngestionRunId()
  const second = createIngestionRunId()
  assert.match(first, /^[0-9a-f-]{36}$/)
  assert.notEqual(first, second)
  assert.equal(rssIngestionSource('source-1'), 'rss:source-1')
  assert.equal(directUrlIngestionSource(), 'direct_url')
  assert.equal(
    correspondentIngestionSource('HTTPS://EXAMPLE.COM/NEWS/'),
    correspondentIngestionSource('https://example.com/news'),
  )
})

test('collect route stores and returns one explicit ingestion run', () => {
  const source = fs.readFileSync(path.join(root, 'app/api/collect/route.ts'), 'utf8')
  assert.match(source, /const ingestionRunId = createIngestionRunId\(\)/)
  assert.match(source, /ingestion_run_id: ingestionRunId/)
  assert.match(source, /ingestion_source: rssIngestionSource\(source\.id\)/)
  assert.match(source, /ingestion_source: directUrlIngestionSource\(\)/)
  assert.match(source, /ingestionRunId,/)
})

test('suggest route selects metadata, hydrates chosen IDs, and checks completed pools', () => {
  const source = fs.readFileSync(path.join(root, 'app/api/suggest-clusters/route.ts'), 'utf8')
  assert.match(source, /selectSuggestPool\(supabase/)
  assert.match(source, /hydrateSelectedArticles\(supabase, pool\.articleIds\)/)
  assert.match(source, /preferredIngestionRunId/)
  assert.match(source, /await markRawArticlesChecked\(completion\.checkedArticleIds\)/)
  assert.match(source, /pool_policy: pool\.diagnostics\.policy/)
  assert.match(source, /batches\.length > 0 && successfulLlmBatches === 0/)
  assert.match(source, /모든 LLM batch가 실패해 pool evaluation을 완료하지 못했습니다/)
})

test('partial route failure checks successful batches and non-LLM pool only', () => {
  const nonLlmIds = ['non-llm-1', 'non-llm-2']
  const successfulBatchIds = Array.from({ length: 40 }, (_, index) => `success-${index}`)
  const timeoutBatchIds = Array.from({ length: 20 }, (_, index) => `timeout-${index}`)
  const poolIds = [...nonLlmIds, ...successfulBatchIds, ...timeoutBatchIds]

  const completion = resolvePoolEvaluationCompletion(
    poolIds,
    timeoutBatchIds,
    false,
  )

  assert.deepEqual(completion.retryableArticleIds, timeoutBatchIds)
  assert.ok(timeoutBatchIds.every((id) => !completion.checkedArticleIds.includes(id)))
  assert.ok(successfulBatchIds.every((id) => completion.checkedArticleIds.includes(id)))
  assert.ok(nonLlmIds.every((id) => completion.checkedArticleIds.includes(id)))
  assert.equal(completion.checkedArticleIds.length, 42)
})

test('full LLM failure checks nothing and retries the entire pool', () => {
  const poolIds = ['non-llm', 'failed-1', 'failed-2']
  const completion = resolvePoolEvaluationCompletion(poolIds, ['failed-1', 'failed-2'], true)
  assert.deepEqual(completion.checkedArticleIds, [])
  assert.deepEqual(completion.retryableArticleIds, poolIds)
})

test('Suggest 2 uses independent checked state after completed group decisions', () => {
  const source = fs.readFileSync(
    path.join(root, 'app/api/suggest-clusters/extended/route.ts'),
    'utf8',
  )
  assert.match(source, /excludeCurrentFreshCohorts\(eligibleArticles\)/)
  assert.match(source, /fetchAllEligibleArticles\(\)/)
  assert.match(source, /\.range\(from, from \+ BACKLOG_PAGE_SIZE - 1\)/)
  assert.match(source, /buildPairClusters\(rawArticles/)
  assert.match(source, /orderSuggest2Groups\(groups, rawArticles\)\.slice\(0, 30\)/)
  assert.match(source, /markRawArticlesSuggest2Checked\(completedSuggest2ArticleIds\(groupResults\)\)/)
  assert.match(source, /parseSuggest2Decision\(ollamaData\.response \?\? ''\)/)
  assert.match(source, /markRawArticlesSuggestedBySuggest2\(saveableSuggestions\)/)
  assert.doesNotMatch(source, /markRawArticlesChecked/)
})

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArticleRenderer } from '@/components/ArticleRenderer'

const route = readFileSync(path.resolve(process.cwd(), 'app/api/articles/[id]/route.ts'), 'utf8')

test('legacy PATCH clears content_blocks in the same update payload', () => {
  assert.match(route, /\.update\(\{\s*title,\s*content,\s*content_blocks:\s*null,/)
})

test('cleared block article renders the newly saved legacy content', () => {
  const html = renderToStaticMarkup(
    React.createElement(ArticleRenderer, {
      content: 'legacy PATCH의 새 본문',
      contentBlocks: null,
    })
  )
  assert.match(html, /<p>legacy PATCH의 새 본문<\/p>/)
  assert.doesNotMatch(html, /stale block/)
})

test('published legacy PATCH keeps exactly one deploy invocation', () => {
  assert.equal(route.match(/await triggerDeployHook\(\)/g)?.length, 1)
  assert.match(route, /if \(existing\.published\) \{\s*await triggerDeployHook\(\)/)
})

test('Daily Pipeline callers do not use the legacy PATCH route', () => {
  const dailyRoute = readFileSync(path.resolve(process.cwd(), 'app/api/articles/publish-batch/route.ts'), 'utf8')
  assert.doesNotMatch(dailyRoute, /api\/articles\/\[id\]|content_blocks/)
  assert.match(dailyRoute, /prepareArticlePublish/)
})

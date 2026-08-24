import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArticleRenderer } from '@/components/ArticleRenderer'
import { parseLegacyArticleBody } from '@/lib/article-body'

test('legacy paragraphs and attribution preserve their block structure', () => {
  const content = [
    '첫 번째 문단입니다.',
    '두 번째 문단입니다.',
    '*이 기사는 Example의 원문을 바탕으로 작성했습니다. [원문 보기](https://example.com/story)*',
  ].join('\n\n')

  assert.deepEqual(parseLegacyArticleBody(content), [
    { type: 'paragraph', text: '첫 번째 문단입니다.' },
    { type: 'paragraph', text: '두 번째 문단입니다.' },
    {
      type: 'attribution',
      textBeforeLink: '이 기사는 Example의 원문을 바탕으로 작성했습니다. ',
      linkText: '원문 보기',
      href: 'https://example.com/story',
      textAfterLink: '',
    },
  ])

  const html = renderToStaticMarkup(<ArticleRenderer content={content} />)
  assert.match(html, /<p>첫 번째 문단입니다\.<\/p>/)
  assert.match(html, /<p>두 번째 문단입니다\.<\/p>/)
  assert.match(html, /<p><em>.*<a[^>]+rel="noopener noreferrer nofollow"[^>]*>원문 보기<\/a><\/em><\/p>/)
})

test('cover image remains first and duplicate markdown image is not added twice', () => {
  const imageUrl = 'https://example.com/cover.jpg'
  const content = `본문입니다.\n\n![대표 이미지](${imageUrl})`

  const blocks = parseLegacyArticleBody(content, imageUrl)
  assert.equal(blocks.filter((block) => block.type === 'image').length, 1)

  const withSeparateCover = parseLegacyArticleBody('본문입니다.', imageUrl)
  assert.deepEqual(withSeparateCover[0], { type: 'image', alt: '', src: imageUrl })
})

test('valid blocks render structured content and malformed blocks fall back to legacy content', () => {
  const valid = {
    version: 1,
    blocks: [
      { type: 'heading', level: 2, content: [{ type: 'text', text: '소제목' }] },
      { type: 'paragraph', content: [{ type: 'link', text: '외부 링크', href: 'https://example.com' }] },
    ],
  }
  const html = renderToStaticMarkup(<ArticleRenderer content="legacy" contentBlocks={valid} />)
  assert.match(html, /<h2[^>]*>소제목<\/h2>/)
  assert.match(html, /rel="noopener noreferrer nofollow"/)

  const fallback = renderToStaticMarkup(
    <ArticleRenderer content="legacy 본문" contentBlocks={{ version: 1, blocks: [{ type: 'unknown' }] }} />
  )
  assert.match(fallback, /<p>legacy 본문<\/p>/)
})

test('strong, emphasis, formatted list items, and image metadata render semantic DOM', () => {
  const document = {
    version: 1,
    blocks: [
      { type: 'list', ordered: false, items: [[
        { type: 'strong', content: [{ type: 'text', text: '행사명' }] },
        { type: 'text', text: ': ' },
        { type: 'link', text: 'TRICO', href: 'https://example.com' },
      ]] },
      { type: 'paragraph', content: [{ type: 'emphasis', content: [{ type: 'text', text: '강조' }] }] },
      { type: 'image', src: 'https://example.com/poster.webp', alt: '포스터', caption: '행사 포스터', credit: 'TRICO' },
    ],
  }
  const html = renderToStaticMarkup(<ArticleRenderer content="" contentBlocks={document} />)
  assert.match(html, /<strong>행사명<\/strong>/)
  assert.match(html, /<em>강조<\/em>/)
  assert.match(html, /<a[^>]+>TRICO<\/a>/)
  assert.match(html, /alt="포스터"/)
  assert.match(html, /<figcaption[^>]*>행사 포스터 · TRICO<\/figcaption>/)
})

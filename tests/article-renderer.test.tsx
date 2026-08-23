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

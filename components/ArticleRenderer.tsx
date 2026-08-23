import { parseLegacyArticleBody } from '@/lib/article-body'
import {
  type ArticleBlockDocument,
  type ArticleInline,
  validateArticleBlockDocument,
} from '@/lib/article-blocks'

type ArticleRendererProps = {
  content: string
  contentBlocks?: unknown | null
  leadingImageUrl?: string | null
}

function InlineContent({ content }: { content: ArticleInline[] }) {
  return content.map((inline, index) => inline.type === 'link' ? (
    <a
      key={index}
      href={inline.href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="underline underline-offset-2"
    >
      {inline.text}
    </a>
  ) : inline.text)
}

function BlockDocumentRenderer({ document }: { document: ArticleBlockDocument }) {
  const leadingImageIndex = document.blocks.findIndex((block) => block.type === 'image')
  return (
    <div className="text-[17px] leading-[1.9] text-[#0A0A0A] space-y-5">
      {document.blocks.map((block, index) => {
        if (block.type === 'image') return (
          <figure key={index} className="my-8 overflow-hidden bg-gray-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={block.src} alt={block.alt} loading={index === leadingImageIndex ? 'eager' : 'lazy'} decoding="async" className="w-full h-auto object-cover" />
            {block.alt && <figcaption className="mt-2 text-sm text-gray-500 px-1">{block.alt}</figcaption>}
          </figure>
        )
        if (block.type === 'heading') {
          const children = <InlineContent content={block.content} />
          return block.level === 2
            ? <h2 key={index} className="pt-5 text-2xl font-black leading-tight">{children}</h2>
            : <h3 key={index} className="pt-3 text-xl font-bold leading-tight">{children}</h3>
        }
        if (block.type === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul'
          return <Tag key={index} className={`space-y-2 pl-6 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
            {block.items.map((item, itemIndex) => <li key={itemIndex}><InlineContent content={item} /></li>)}
          </Tag>
        }
        if (block.type === 'blockquote') return (
          <blockquote key={index} className="border-l-4 border-gray-300 pl-5 italic text-gray-700">
            <InlineContent content={block.content} />
          </blockquote>
        )
        if (block.type === 'attribution') return <p key={index}><em><InlineContent content={block.content} /></em></p>
        return <p key={index}><InlineContent content={block.content} /></p>
      })}
    </div>
  )
}

export function ArticleRenderer({ content, contentBlocks, leadingImageUrl }: ArticleRendererProps) {
  if (contentBlocks !== null && contentBlocks !== undefined) {
    const validated = validateArticleBlockDocument(contentBlocks)
    if (validated.ok) {
      const normalizedLeadingImageUrl = leadingImageUrl?.trim()
      const document = normalizedLeadingImageUrl &&
        !validated.document.blocks.some((block) => block.type === 'image' && block.src === normalizedLeadingImageUrl)
        ? {
            ...validated.document,
            blocks: [
              { type: 'image' as const, src: normalizedLeadingImageUrl, alt: '' },
              ...validated.document.blocks,
            ],
          }
        : validated.document
      return <BlockDocumentRenderer document={document} />
    }
  }

  const blocks = parseLegacyArticleBody(content, leadingImageUrl)
  const leadingImageIndex = blocks.findIndex((block) => block.type === 'image')

  return (
    <div className="text-[17px] leading-[1.9] text-[#0A0A0A] space-y-5">
      {blocks.map((block, index) => {
        if (block.type === 'image') {
          return (
            <figure key={index} className="my-8 overflow-hidden bg-gray-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={block.src}
                alt={block.alt}
                loading={index === leadingImageIndex ? 'eager' : 'lazy'}
                decoding="async"
                className="w-full h-auto object-cover"
              />
              {block.alt && (
                <figcaption className="mt-2 text-sm text-gray-500 px-1">
                  {block.alt}
                </figcaption>
              )}
            </figure>
          )
        }

        if (block.type === 'attribution') {
          return (
            <p key={index}>
              <em>
                {block.textBeforeLink}
                <a
                  href={block.href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="underline underline-offset-2"
                >
                  {block.linkText}
                </a>
                {block.textAfterLink}
              </em>
            </p>
          )
        }

        return <p key={index}>{block.text}</p>
      })}
    </div>
  )
}

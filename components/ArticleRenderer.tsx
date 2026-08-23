import { parseLegacyArticleBody } from '@/lib/article-body'

type ArticleRendererProps = {
  content: string
  leadingImageUrl?: string | null
}

export function ArticleRenderer({ content, leadingImageUrl }: ArticleRendererProps) {
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

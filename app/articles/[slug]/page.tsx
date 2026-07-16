import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { isUsableImageUrl, loadClusterImageUrl, loadPublishedArticles } from "@/lib/articles";
import { ArticleCard } from "@/components/ArticleCard";
import { DEFAULT_OG_IMAGE_URL, PUBLISHER } from "@/lib/site";

// ── 원본 유지 — 데이터/유틸 ───────────────────────────

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ARTICLE_SELECT =
  "id, title, content, published, published_at, created_at, updated_at, cluster_id, image_url, slug, category, genre";

export async function generateStaticParams() {
  const { data } = await supabase
    .from("articles")
    .select("id, slug")
    .eq("published", true);
  return (data ?? []).map((row: { id: string; slug: string | null }) => ({
    slug: row.slug ?? row.id,
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { data } = await loadArticle(slug);

  if (!data) {
    return {
      title: "기사 없음 | FEEL THE DROP",
      description: "한국어 EDM 뉴스 종합",
    };
  }

  const description = createMetaDescription(data.content);
  const imageUrl = isUsableImageUrl(data.image_url)
    ? data.image_url
    : (await loadClusterImageUrl(data.cluster_id)) ??
      extractFirstMarkdownImage(data.content);
  const articlePath = `/articles/${data.slug ?? data.id}/`;

  return {
    title: `${data.title} | FEEL THE DROP`,
    description,
    alternates: {
      canonical: articlePath,
    },
    openGraph: {
      title: data.title,
      description,
      type: "article",
      url: articlePath,
      publishedTime: data.published_at ?? data.created_at,
      modifiedTime: data.updated_at ?? undefined,
      images: [{ url: imageUrl ?? DEFAULT_OG_IMAGE_URL }],
    },
  };
}

type ArticleDetail = {
  id: string;
  title: string;
  content: string;
  published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string | null;
  cluster_id: string | null;
  image_url: string | null;
  slug: string | null;
  category: string | null;
  genre: string | null;
};

async function loadArticle(key: string): Promise<{
  data: ArticleDetail | null;
  errorMessage: string | null;
}> {
  const bySlug = await supabase
    .from("articles")
    .select(ARTICLE_SELECT)
    .eq("slug", key)
    .eq("published", true)
    .maybeSingle();
  if (bySlug.error) return { data: null, errorMessage: bySlug.error.message };
  if (bySlug.data)
    return { data: bySlug.data as ArticleDetail, errorMessage: null };

  if (UUID_PATTERN.test(key)) {
    const byId = await supabase
      .from("articles")
      .select(ARTICLE_SELECT)
      .eq("id", key)
      .eq("published", true)
      .maybeSingle();
    if (byId.error) return { data: null, errorMessage: byId.error.message };
    return {
      data: (byId.data as ArticleDetail | null) ?? null,
      errorMessage: null,
    };
  }

  return { data: null, errorMessage: null };
}

// ── 본문 블록 파싱 ─────────────────────────────────────
type ArticleBlock =
  | { type: "paragraph"; text: string }
  | {
      type: "attribution";
      textBeforeLink: string;
      linkText: string;
      href: string;
      textAfterLink: string;
    }
  | { type: "image"; alt: string; src: string };

function splitTextBlocks(text: string): ArticleBlock[] {
  return text.split('\n\n').map((s) => s.trim()).filter(Boolean).map((paragraph) => {
    const attributionMatch = paragraph.match(
      /^\*([^\n]*?)\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)([^\n]*?)\*$/
    );

    if (attributionMatch) {
      return {
        type: "attribution" as const,
        textBeforeLink: attributionMatch[1],
        linkText: attributionMatch[2],
        href: attributionMatch[3],
        textAfterLink: attributionMatch[4],
      };
    }

    return { type: "paragraph" as const, text: paragraph };
  });
}

function splitArticleBlocks(
  text: string,
  leadingImageUrl?: string | null
): ArticleBlock[] {
  if (!text?.trim()) return [];

  const imagePattern = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
  const blocks: ArticleBlock[] = [];
  const normalizedLeadingImageUrl = leadingImageUrl?.trim();

  if (
    normalizedLeadingImageUrl &&
    !text.includes(normalizedLeadingImageUrl)
  ) {
    blocks.push({ type: "image", alt: "", src: normalizedLeadingImageUrl });
  }

  let cursor = 0;
  for (const match of text.matchAll(imagePattern)) {
    const index = match.index ?? 0;
    const before = text.slice(cursor, index);
    blocks.push(...splitTextBlocks(before));
    blocks.push({
      type: "image",
      alt: match[1].trim(),
      src: match[2].trim(),
    });
    cursor = index + match[0].length;
  }

  blocks.push(...splitTextBlocks(text.slice(cursor)));

  return blocks;
}

function createMetaDescription(content: string): string {
  const normalized = content
    .replace(/!\[[^\]]*\]\(https?:\/\/[^)\s]+\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= 155) return normalized || "한국어 EDM 뉴스 종합";
  return `${normalized.slice(0, 152).replace(/\s+\S*$/, "")}...`;
}

function extractFirstMarkdownImage(content: string): string | null {
  const match = content.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/);
  return match?.[1] ?? null;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// ── 카테고리 배지 색상 ────────────────────────────────

const CATEGORY_BADGE: Record<string, string> = {
  페스티벌: "bg-orange-500",
  릴리즈: "bg-emerald-600",
  뉴스: "bg-blue-600",
};

function badgeCls(category?: string | null): string {
  return category ? (CATEGORY_BADGE[category] ?? "bg-gray-800") : "bg-gray-800";
}

// ── 페이지 ────────────────────────────────────────────

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { data, errorMessage } = await loadArticle(slug);

  if (errorMessage) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-12">
        <BackLink />
        <div className="mt-6 p-4 border border-red-200 bg-red-50 text-red-700 text-sm">
          기사를 불러오지 못했습니다: {errorMessage}
        </div>
      </div>
    );
  }

  if (!data) notFound();

  if (data.slug && slug !== data.slug) {
    permanentRedirect(`/articles/${data.slug}/`);
  }

  const article = data;
  const articleImageUrl = isUsableImageUrl(article.image_url)
    ? article.image_url
    : (await loadClusterImageUrl(article.cluster_id)) ??
      extractFirstMarkdownImage(article.content);

  const articleBlocks = splitArticleBlocks(article.content, articleImageUrl);

  const showUpdated =
    article.published_at &&
    article.updated_at &&
    article.updated_at !== article.published_at;

  const relatedArticles = article.category
    ? (
        await loadPublishedArticles({
          category: article.category,
          limit: 10,
        })
      ).articles
        .filter((a) => a.id !== article.id)
        .slice(0, 3)
    : [];

  return (
    <div className="max-w-[1280px] mx-auto px-4 md:px-6 lg:px-8 py-8 md:py-12">
      <BackLink />

      <article className="mt-6 max-w-[720px]">
        {/* 날짜 + 초안 뱃지 */}
        <div className="flex flex-wrap items-center gap-2 mb-4 text-xs text-gray-500">
          {article.published_at ? (
            <time>발행 {formatDate(article.published_at)}</time>
          ) : (
            <time>생성 {formatDate(article.created_at)}</time>
          )}
          {showUpdated && article.updated_at && (
            <span className="text-gray-400">
              · 수정됨 {formatDate(article.updated_at)}
            </span>
          )}
          {!article.published && (
            <span className="px-1.5 py-0.5 bg-gray-200 text-gray-600 text-[11px] font-medium">
              초안
            </span>
          )}
        </div>

        {/* 카테고리 + 장르 배지 */}
        {(article.category || article.genre) && (
          <div className="flex flex-wrap items-center gap-1.5 mb-4">
            {article.category && (
              <span
                className={`inline-block px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white ${badgeCls(article.category)}`}
                style={{ fontFamily: "var(--font-display), sans-serif" }}
              >
                {article.category}
              </span>
            )}
            {article.genre && (
              <span
                className="inline-block px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider border border-gray-300 text-gray-600"
                style={{ fontFamily: "var(--font-display), sans-serif" }}
              >
                {article.genre}
              </span>
            )}
          </div>
        )}

        {/* 제목 */}
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-black leading-tight tracking-tight mb-4">
          {article.title}
        </h1>

        {/* 발행인 구분선 */}
        <div className="mb-8 pb-4 border-b border-gray-200 text-sm">
          <span className="text-gray-500">기사 · 편집</span>
          <span className="ml-2 text-gray-800 font-medium">{PUBLISHER}</span>
        </div>

        {/* 본문 블록 */}
        <div className="text-[17px] leading-[1.9] text-[#0A0A0A] space-y-5">
          {articleBlocks.map((block, idx) => {
            if (block.type === "image") {
              return (
                <figure key={idx} className="my-8 overflow-hidden bg-gray-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={block.src}
                    alt={block.alt}
                    className="w-full h-auto object-cover"
                  />
                  {block.alt && (
                    <figcaption className="mt-2 text-sm text-gray-500 px-1">
                      {block.alt}
                    </figcaption>
                  )}
                </figure>
              );
            }
            if (block.type === "attribution") {
              return (
                <p key={idx}>
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
              );
            }
            return <p key={idx}>{block.text}</p>;
          })}
        </div>

        {/* 하단 */}
        <div className="mt-12 pt-8 border-t border-gray-200">
          <BackLink />
        </div>
      </article>

      {/* 관련 기사 */}
      {relatedArticles.length > 0 && (
        <section className="mt-16 pt-12 border-t border-gray-200 max-w-[1280px]">
          <h2
            className="text-sm font-bold tracking-[0.2em] uppercase mb-8"
            style={{ fontFamily: "var(--font-display), sans-serif" }}
          >
            관련 기사
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
            {relatedArticles.map((a) => (
              <ArticleCard key={a.id} article={a} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/"
      className="text-sm text-gray-500 hover:text-black transition-colors"
    >
      ← 목록으로
    </Link>
  );
}

import Link from "next/link";
import type { ArticleListItem } from "@/lib/articles";

const CATEGORY_BADGE: Record<string, string> = {
  페스티벌: "bg-orange-500",
  릴리즈: "bg-emerald-600",
  뉴스: "bg-blue-600",
};

function badgeCls(category?: string | null): string {
  return category ? (CATEGORY_BADGE[category] ?? "bg-gray-800") : "bg-gray-800";
}

function articleHref(a: ArticleListItem): string {
  return `/articles/${a.slug ?? a.id}`;
}

function formatDate(iso?: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function ArticleCard({ article }: { article: ArticleListItem }) {
  const href = articleHref(article);
  return (
    <article className="group">
      <Link href={href} className="block">
        {/* 이미지 */}
        <div className="relative aspect-[16/9] overflow-hidden bg-gray-100">
          {article.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={article.imageUrl}
              alt={article.title}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="absolute inset-0 bg-gray-900 flex items-center justify-center">
              {article.category && (
                <span
                  className="text-xs font-bold uppercase tracking-widest text-white/30"
                  style={{ fontFamily: "var(--font-display), sans-serif" }}
                >
                  {article.category}
                </span>
              )}
            </div>
          )}
          {/* 카테고리 배지 */}
          {article.category && (
            <span
              className={`absolute top-2 left-2 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white ${badgeCls(article.category)}`}
              style={{ fontFamily: "var(--font-display), sans-serif" }}
            >
              {article.category}
            </span>
          )}
        </div>

        {/* 텍스트 */}
        <div className="pt-3">
          <h2 className="text-base font-bold leading-snug group-hover:text-[#0052D4] transition-colors line-clamp-2">
            {article.title}
          </h2>
          <time className="text-xs text-gray-500 mt-1.5 block">
            {formatDate(article.published_at)}
          </time>
        </div>
      </Link>
    </article>
  );
}

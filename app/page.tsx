import Link from "next/link";
import {
  loadPopularArticles,
  loadPublishedArticles,
  loadPublishedArticlesByIds,
} from "@/lib/articles";
import type { ArticleListItem } from "@/lib/articles";
import { ArticleCard } from "@/components/ArticleCard";
import {
  HOMEPAGE_LATEST_FETCH_LIMIT,
  HOMEPAGE_POPULAR_INPUT_LIMIT,
  selectHomepageContent,
} from "@/lib/homepage-selection";
import { loadHomepagePlacements } from "@/lib/homepage-placement";
import { loadFeatureArticleIds, loadPublishedFeatureCandidates } from "@/lib/article-features";
import { getArticlePath } from "@/lib/site";

// ── 유틸 ──────────────────────────────────────────────

const CATEGORY_BADGE: Record<string, string> = {
  페스티벌: "bg-orange-500",
  릴리즈: "bg-emerald-600",
  뉴스: "bg-blue-600",
};

function badgeCls(category?: string | null): string {
  return category ? (CATEGORY_BADGE[category] ?? "bg-gray-800") : "bg-gray-800";
}

function formatDate(iso?: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// ── 히어로 ────────────────────────────────────────────

function Hero({ article }: { article: ArticleListItem }) {
  const href = getArticlePath(article);
  return (
    <Link href={href} className="group block mb-10 md:mb-14">
      <div className="relative w-full aspect-[16/9] md:aspect-[21/9] overflow-hidden bg-gray-900">
        {article.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={article.imageUrl}
            alt={article.title}
            loading="eager"
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-950" />
        )}
        {/* 그라데이션 오버레이 */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

        {/* 텍스트 */}
        <div className="absolute bottom-0 left-0 right-0 p-5 md:p-8 lg:p-10">
          {article.category && (
            <span
              className={`inline-block px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white mb-3 ${badgeCls(article.category)}`}
              style={{ fontFamily: "var(--font-display), sans-serif" }}
            >
              {article.category}
            </span>
          )}
          <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-black text-white leading-tight group-hover:text-blue-200 transition-colors">
            {article.title}
          </h1>
          <time className="text-xs text-white/50 mt-3 block">
            {formatDate(article.published_at)}
          </time>
        </div>
      </div>
    </Link>
  );
}

// ── 사이드바 인기 기사 ─────────────────────────────────

function SidebarItem({ article, rank }: { article: ArticleListItem; rank: number }) {
  const href = getArticlePath(article);
  return (
    <article className="group flex gap-3 py-4 border-b border-gray-100 last:border-0">
      {/* 순위 */}
      <span
        className="shrink-0 text-3xl font-black text-gray-100 leading-none pt-0.5 w-8 select-none"
        style={{ fontFamily: "var(--font-display), sans-serif" }}
      >
        {String(rank).padStart(2, "0")}
      </span>
      <div className="min-w-0">
        {article.category && (
          <span
            className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1 block"
            style={{ fontFamily: "var(--font-display), sans-serif" }}
          >
            {article.category}
          </span>
        )}
        <Link href={href}>
          <h3 className="text-sm font-bold leading-snug group-hover:text-[#0052D4] transition-colors line-clamp-2">
            {article.title}
          </h3>
        </Link>
        <time className="text-xs text-gray-400 mt-1 block">
          {formatDate(article.published_at)}
        </time>
      </div>
    </article>
  );
}

// ── 섹션 헤더 ─────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-6 border-b-2 border-black pb-2">
      <h2
        className="text-sm font-bold tracking-[0.2em] uppercase"
        style={{ fontFamily: "var(--font-display), sans-serif" }}
      >
        {label}
      </h2>
    </div>
  );
}

// ── 에러 ──────────────────────────────────────────────

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="p-4 border border-red-200 bg-red-50 text-red-700 text-sm">
      기사를 불러오지 못했습니다: {message}
    </div>
  );
}

// ── 페이지 ────────────────────────────────────────────

export default async function Home() {
  const [{ articles, error }, placementResult, featureResult] = await Promise.all([
    loadPublishedArticles({ limit: HOMEPAGE_LATEST_FETCH_LIMIT }),
    loadHomepagePlacements(),
    loadPublishedFeatureCandidates(10),
  ]);

  if (placementResult.error || placementResult.missing.length > 0) {
    console.warn('[Homepage] placement 조회가 불완전해 유효한 데이터만 사용합니다:', placementResult.error ?? placementResult.missing.join(', '));
  }
  if (featureResult.error) {
    console.warn('[Homepage] Feature 조회 실패, Featured를 생략합니다:', featureResult.error);
  }

  const placedIds = placementResult.placements.flatMap((row) => row.articleId ? [row.articleId] : []);
  const articlesById = new Map(articles.map((article) => [article.id, article]));
  const missingPlacedIds = placedIds.filter((id) => !articlesById.has(id));
  const [placedResult, featureIdsResult] = await Promise.all([
    loadPublishedArticlesByIds(missingPlacedIds),
    featureResult.error ? Promise.resolve({ articleIds: new Set<string>(), error: featureResult.error }) : loadFeatureArticleIds(placedIds),
  ]);
  if (placedResult.error) console.warn('[Homepage] placed article 조회 실패:', placedResult.error);
  if (featureIdsResult.error) console.warn('[Homepage] placement Feature 검증 실패:', featureIdsResult.error);
  for (const article of placedResult.articles) articlesById.set(article.id, article);

  const featureArticleIds = featureResult.error
    ? new Set<string>()
    : new Set([...featureIdsResult.articleIds, ...featureResult.features.map((feature) => feature.article.id)]);
  const popular = await loadPopularArticles(articles.slice(0, HOMEPAGE_POPULAR_INPUT_LIMIT), 5);
  const { hero, featured, latest } = selectHomepageContent({
    latestArticles: articles,
    manualPlacements: placementResult.placements,
    placementArticles: articlesById,
    featureCandidates: featureResult.error ? [] : featureResult.features,
    featureArticleIds,
  });

  return (
    <div className="max-w-[1280px] mx-auto px-4 md:px-6 lg:px-8 py-6 md:py-8">
      {/* 히어로 */}
      {hero && <Hero article={hero} />}

      {featured.length > 0 && (
        <section className="mb-10 md:mb-14">
          <SectionHeader label="특집" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
            {featured.map(({ article }) => <ArticleCard key={article.id} article={article} />)}
          </div>
        </section>
      )}

      {error && <ErrorBanner message={error} />}

      <div className="flex flex-col lg:flex-row gap-10 lg:gap-12">
        {/* 기사 그리드 */}
        <section className="flex-1 min-w-0">
          <SectionHeader label="최신 기사" />
          {latest.length === 0 && !error && (
            <p className="text-sm text-gray-400">아직 발행된 기사가 없습니다.</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
            {latest.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>
        </section>

        {/* 사이드바 */}
        <aside className="w-full lg:w-64 xl:w-72 shrink-0">
          <div className="lg:sticky lg:top-20">
            <SectionHeader label="인기 기사" />
            {popular.map((article, i) => (
              <SidebarItem key={article.id} article={article} rank={i + 1} />
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

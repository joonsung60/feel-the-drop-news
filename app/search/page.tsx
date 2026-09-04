"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { getArticlePath } from "@/lib/site";

type ArticleSearchResult = {
  id: string;
  slug: string | null;
  title: string;
  published_at: string | null;
  image_url: string | null;
  category: string | null;
};

const CATEGORY_BADGE: Record<string, string> = {
  "페스티벌": "bg-orange-500 text-white",
  "릴리즈": "bg-emerald-600 text-white",
  "뉴스": "bg-blue-600 text-white",
};

function escapeIlikePattern(value: string) {
  return value.replace(/[%_]/g, (match) => `\\${match}`);
}

function formatDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function badgeClass(category: string | null) {
  if (!category) return "bg-gray-800 text-white";
  return CATEGORY_BADGE[category] ?? "bg-gray-800 text-white";
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ArticleSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const term = query.trim();

  const supabase = useMemo(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) return null;
    return createClient(supabaseUrl, supabaseAnonKey);
  }, []);

  useEffect(() => {
    if (!term || !supabase) return;

    let isActive = true;

    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      const pattern = `%${escapeIlikePattern(term)}%`;
      const { data, error: searchError } = await supabase
        .from("articles")
        .select("id, slug, title, published_at, image_url, category")
        .eq("published", true)
        .or(`title.ilike.${pattern},content.ilike.${pattern}`)
        .order("published_at", { ascending: false })
        .limit(30);

      if (!isActive) return;

      if (searchError) {
        setResults([]);
        setError(searchError.message);
      } else {
        setResults((data ?? []) as ArticleSearchResult[]);
        setError(null);
      }

      setHasSearched(true);
      setIsLoading(false);
    }, 300);

    return () => {
      isActive = false;
      window.clearTimeout(timer);
    };
  }, [term, supabase]);

  return (
    <div className="max-w-[1280px] mx-auto px-4 md:px-6 lg:px-8 py-8 md:py-12">
      <header className="mb-8 border-b-2 border-black pb-4">
        <p
          className="text-xs font-bold tracking-[0.2em] uppercase text-gray-500"
          style={{ fontFamily: "var(--font-display), sans-serif" }}
        >
          Search
        </p>
        <h1 className="mt-2 text-3xl sm:text-4xl font-black leading-tight">
          기사 검색
        </h1>
      </header>

      <label className="block">
        <span className="sr-only">검색어</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="아티스트, 페스티벌, 릴리즈 검색"
          className="w-full border-2 border-black bg-white px-4 py-3 text-base font-medium outline-none transition-colors placeholder:text-gray-400 focus:border-[#0052D4]"
          autoComplete="off"
        />
      </label>

      <div className="mt-8">
        {term && isLoading && (
          <p className="py-8 text-sm text-gray-500">검색 중입니다.</p>
        )}

        {term && !supabase && (
          <p className="border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            검색하지 못했습니다: Supabase 환경변수가 설정되지 않았습니다.
          </p>
        )}

        {term && !isLoading && error && (
          <p className="border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            검색하지 못했습니다: {error}
          </p>
        )}

        {term && !isLoading && !error && hasSearched && results.length === 0 && (
          <p className="py-8 text-sm text-gray-500">
            검색 결과가 없습니다. 다른 검색어를 입력해보세요.
          </p>
        )}

        {term && !isLoading && !error && results.length > 0 && (
          <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((article) => (
              <li key={article.id}>
                <Link href={getArticlePath(article)} className="group block">
                  <div className="relative aspect-[16/9] overflow-hidden bg-gray-100">
                    {article.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={article.image_url}
                        alt=""
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gray-900 text-xs font-bold uppercase tracking-widest text-gray-400">
                        FEEL THE DROP
                      </div>
                    )}
                    {article.category && (
                      <span
                        className={`absolute left-2 top-2 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${badgeClass(article.category)}`}
                        style={{ fontFamily: "var(--font-display), sans-serif" }}
                      >
                        {article.category}
                      </span>
                    )}
                  </div>
                  <div className="pt-3">
                    <h2 className="text-lg font-bold leading-snug transition-colors group-hover:text-[#0052D4]">
                      {article.title}
                    </h2>
                    {article.published_at && (
                      <time className="mt-1 block text-xs text-gray-500">
                        {formatDate(article.published_at)}
                      </time>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

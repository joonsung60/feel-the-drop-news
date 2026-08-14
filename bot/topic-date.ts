type TopicArticleDates = {
  eventDate?: unknown;
  publishedAt?: unknown;
};

type TopicWithArticles = {
  articles?: unknown;
};

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const SEOUL_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function isValidDateOnly(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function toSeoulDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  if (!isValidDateOnly(value.slice(0, 10))) return null;
  if (value.length > 10 && value[10] !== "T") return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = SEOUL_DATE_FORMATTER.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return year && month && day ? `${year}-${month}-${day}` : null;
}

function topicArticles(topic: TopicWithArticles): TopicArticleDates[] {
  return Array.isArray(topic.articles)
    ? topic.articles.filter(
      (article): article is TopicArticleDates => typeof article === "object" && article !== null,
    )
    : [];
}

export function formatTopicDates(topic: TopicWithArticles): {
  eventDates: string;
  publishedDates: string;
} {
  const articles = topicArticles(topic);
  const eventDates = Array.from(new Set(
    articles.map((article) => article.eventDate).filter(isValidDateOnly),
  )).sort();
  const publishedDates = Array.from(new Set(
    articles
      .map((article) => toSeoulDate(article.publishedAt))
      .filter((date): date is string => date !== null),
  )).sort();

  return {
    eventDates: eventDates.length > 0 ? eventDates.join(", ") : "확인 불가",
    publishedDates: publishedDates.length === 0
      ? "확인 불가"
      : publishedDates.length === 1
        ? publishedDates[0]
        : `${publishedDates[0]} ~ ${publishedDates[publishedDates.length - 1]}`,
  };
}

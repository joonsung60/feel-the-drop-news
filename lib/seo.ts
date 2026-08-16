import type { Metadata } from 'next'
import {
  DEFAULT_OG_IMAGE_URL,
  ORGANIZATION_LOGO_URL,
  PUBLISHER,
  RSS_ALTERNATE,
  SITE_URL,
  SOCIAL_LINKS,
} from '@/lib/site'

export const ORGANIZATION_ID = `${SITE_URL}/#organization`

export const ORGANIZATION_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': ORGANIZATION_ID,
  name: PUBLISHER,
  url: `${SITE_URL}/`,
  logo: {
    '@type': 'ImageObject',
    url: ORGANIZATION_LOGO_URL,
  },
  sameAs: SOCIAL_LINKS.map(({ url }) => url),
}

export const WEBSITE_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': `${SITE_URL}/#website`,
  name: PUBLISHER,
  url: `${SITE_URL}/`,
  inLanguage: 'ko-KR',
  publisher: { '@id': ORGANIZATION_ID },
}

export type BreadcrumbItem = {
  name: string
  path: string
}

export function createBreadcrumbJsonLd(items: BreadcrumbItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  }
}

export function createArchiveMetadata({
  title,
  description,
  path,
}: {
  title: string
  description: string
  path: string
}): Metadata {
  return {
    title,
    description,
    alternates: {
      canonical: path,
      types: { 'application/rss+xml': RSS_ALTERNATE },
    },
    openGraph: {
      title,
      description,
      url: path,
      type: 'website',
      locale: 'ko_KR',
      siteName: PUBLISHER,
      images: [{ url: DEFAULT_OG_IMAGE_URL }],
    },
  }
}

export function absoluteUrl(path: string): string {
  return new URL(path, `${SITE_URL}/`).toString()
}

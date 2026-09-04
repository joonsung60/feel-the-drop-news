export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://feel-the-drop.com').replace(/\/$/, '')

export const DEFAULT_OG_IMAGE_PATH = '/og-default-1200x630.png'
export const DEFAULT_OG_IMAGE_URL = SITE_URL + DEFAULT_OG_IMAGE_PATH
export const ORGANIZATION_LOGO_URL = SITE_URL + '/logo.png'
export const RSS_URL = SITE_URL + '/feed.xml'
export const RSS_ALTERNATE = [{ title: 'FEEL THE DROP RSS', url: RSS_URL }]

export function getArticlePath(article: { id: string; slug?: string | null }): string {
  return `/articles/${article.slug ?? article.id}/`
}

export function getArticleUrl(article: { id: string; slug?: string | null }): string {
  return SITE_URL + getArticlePath(article)
}

export const CONTACT_EMAIL = 'feelthedrop.official@gmail.com'

export const SOCIAL_LINKS = [
  { platform: 'instagram', locale: 'KR', handle: '@feelthedrop_kr', url: 'https://www.instagram.com/feelthedrop_kr/' },
  { platform: 'instagram', locale: 'JP', handle: '@feelthedrop_jp', url: 'https://www.instagram.com/feelthedrop_jp/' },
] as const

export const PUBLISHER = 'FEEL THE DROP'
export const PUBLISHER_NAMES = '최민지, 곽준성'
export const EDITOR_NAME = '곽준성'
export const MAKER_NAMES = PUBLISHER_NAMES

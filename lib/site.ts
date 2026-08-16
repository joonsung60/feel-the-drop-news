export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://feel-the-drop.com').replace(/\/$/, '')

export const DEFAULT_OG_IMAGE_PATH = '/og-default-1200x630.png'
export const DEFAULT_OG_IMAGE_URL = SITE_URL + DEFAULT_OG_IMAGE_PATH
export const ORGANIZATION_LOGO_URL = SITE_URL + '/logo.png'

export const CONTACT_EMAIL = 'feelthedrop.official@gmail.com'

export const SOCIAL_LINKS = [
  { platform: 'instagram', locale: 'KR', handle: '@feelthedrop_kr', url: 'https://www.instagram.com/feelthedrop_kr/' },
  { platform: 'instagram', locale: 'JP', handle: '@feelthedrop_jp', url: 'https://www.instagram.com/feelthedrop_jp/' },
] as const

export const PUBLISHER = 'FEEL THE DROP'

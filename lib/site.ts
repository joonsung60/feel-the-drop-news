export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://feel-the-drop.com').replace(/\/$/, '')

export const DEFAULT_OG_IMAGE_PATH = '/og-default-1200x630.png'
export const DEFAULT_OG_IMAGE_URL = SITE_URL + DEFAULT_OG_IMAGE_PATH

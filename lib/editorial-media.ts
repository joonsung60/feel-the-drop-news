import type { ArticleBlockDocument } from '@/lib/article-blocks'

export const EDITORIAL_MEDIA_BUCKET = 'image-sources'
export const EDITORIAL_MEDIA_PREFIX = 'editorial/'
export const MAX_EDITORIAL_IMAGE_BYTES = 8 * 1024 * 1024

const MIME_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const

export type EditorialImageMime = keyof typeof MIME_EXTENSIONS

export function detectEditorialImageMime(bytes: Uint8Array): EditorialImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return 'image/png'
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

export function createEditorialStoragePath(mime: EditorialImageMime, now = new Date(), id = crypto.randomUUID()): string {
  const year = String(now.getUTCFullYear())
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${EDITORIAL_MEDIA_PREFIX}${year}/${month}/${id}.${MIME_EXTENSIONS[mime]}`
}

export function isManagedEditorialPath(value: unknown): value is string {
  return typeof value === 'string' && /^editorial\/\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i.test(value)
}

export function collectManagedEditorialPaths(document: ArticleBlockDocument | null | undefined, coverPath?: string | null): Set<string> {
  const paths = new Set<string>()
  if (isManagedEditorialPath(coverPath)) paths.add(coverPath)
  for (const block of document?.blocks ?? []) {
    if (block.type === 'image' && isManagedEditorialPath(block.storagePath)) paths.add(block.storagePath)
  }
  return paths
}

import { validateArticleBlockDocument } from '@/lib/article-blocks'
import { collectManagedEditorialPaths } from '@/lib/editorial-media'

export type EditorialMediaReferenceRow = {
  id?: string
  content_blocks: unknown | null
  cover_image_path: string | null
}

export type EditorialMediaReferencePage = {
  rows: EditorialMediaReferenceRow[]
  error: string | null
}

export type EditorialMediaCleanupResult = {
  deleted: string[]
  referenced: string[]
  error: string | null
}

type EditorialMediaCleanupDependencies = {
  fetchPage: (from: number, to: number) => Promise<EditorialMediaReferencePage>
  remove: (paths: string[]) => Promise<{ error: string | null }>
  pageSize?: number
}

export async function cleanupEditorialMediaWithReferences(
  candidates: Iterable<string>,
  dependencies: EditorialMediaCleanupDependencies
): Promise<EditorialMediaCleanupResult> {
  const paths = Array.from(new Set(candidates))
  if (paths.length === 0) return { deleted: [], referenced: [], error: null }

  const referenced = new Set<string>()
  const pageSize = dependencies.pageSize ?? 1000
  for (let from = 0; ; from += pageSize) {
    const page = await dependencies.fetchPage(from, from + pageSize - 1)
    if (page.error) return { deleted: [], referenced: [...referenced], error: page.error }
    for (const article of page.rows) {
      const validated = validateArticleBlockDocument(article.content_blocks)
      if (article.content_blocks !== null && !validated.ok) {
        return {
          deleted: [],
          referenced: [...referenced],
          error: 'Invalid content_blocks prevented a complete media reference check.',
        }
      }
      for (const path of collectManagedEditorialPaths(
        validated.ok ? validated.document : null,
        article.cover_image_path
      )) {
        if (paths.includes(path)) referenced.add(path)
      }
    }
    if (page.rows.length < pageSize) break
  }

  const removable = paths.filter((path) => !referenced.has(path))
  if (removable.length === 0) {
    return { deleted: [], referenced: [...referenced], error: null }
  }
  const removal = await dependencies.remove(removable)
  if (removal.error) return { deleted: [], referenced: [...referenced], error: removal.error }
  return { deleted: removable, referenced: [...referenced], error: null }
}

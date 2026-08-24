import { EDITORIAL_MEDIA_BUCKET } from '@/lib/editorial-media'
import {
  cleanupEditorialMediaWithReferences,
  type EditorialMediaCleanupResult,
} from '@/lib/editorial-media-references'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

export async function cleanupUnreferencedEditorialMedia(
  candidates: Iterable<string>
): Promise<EditorialMediaCleanupResult> {
  const result = await cleanupEditorialMediaWithReferences(candidates, {
    fetchPage: async (from, to) => {
      const { data, error } = await supabase.from('articles')
        .select('id, content_blocks, cover_image_path')
        .order('id', { ascending: true })
        .range(from, to)
      return { rows: data ?? [], error: error?.message ?? null }
    },
    remove: async (paths) => {
      const { error } = await supabase.storage.from(EDITORIAL_MEDIA_BUCKET).remove(paths)
      return { error: error?.message ?? null }
    },
  })
  if (result.error) console.warn('[editorial-media] cleanup skipped or failed:', result.error)
  return result
}

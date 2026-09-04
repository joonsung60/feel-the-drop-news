import type { Metadata } from 'next'
import { EDITOR_NAME } from '@/lib/site'
import { ArchiveView } from '@/components/ArchiveView'
import { loadFeatureArchivePage } from '@/lib/article-features'
import { createArchiveMetadata } from '@/lib/seo'

export const metadata: Metadata = createArchiveMetadata({
  title: '특집 기사 | FEEL THE DROP',
  description: `FEEL THE DROP 편집인 ${EDITOR_NAME}이 선정한 특집 기사를 확인하세요.`,
  path: '/features/',
})

export default async function FeaturesPage() {
  const archive = await loadFeatureArchivePage({ page: 1 })
  return <ArchiveView
    eyebrow="Feature"
    title="특집 기사"
    archive={archive}
    basePath="/features"
    emptyMessage="현재 공개된 특집 기사가 없습니다."
    breadcrumbs={[{ name: '홈', path: '/' }, { name: '특집', path: '/features/' }]}
  />
}

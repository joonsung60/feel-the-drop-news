import type { DeployHookResult } from '@/lib/deploy-hook'
import type { HomepagePlacement } from '@/lib/homepage-selection'
import {
  resolveHeroUnpublishOutcome,
  type HeroDeployState,
} from '@/lib/homepage-hero-mutation'

export type EditorialMutationStatus =
  | 'updated' | 'unchanged' | 'article_not_found'
  | 'article_unpublished' | 'article_not_featured'

export type EditorialMutationResult = {
  result: EditorialMutationStatus
  articleId: string | null
  placement?: HomepagePlacement | null
  changed: boolean
  updatedAt?: string | null
  featuredAt?: string | null
  clearedPlacements?: HomepagePlacement[]
}

const homepagePlacementLabels: Record<HomepagePlacement, string> = {
  homepage_hero: 'Hero',
  homepage_featured_1: 'Featured #1',
  homepage_featured_2: 'Featured #2',
  homepage_featured_3: 'Featured #3',
}

export function homepagePlacementConfirmationMessage(context: {
  currentPlacement: HomepagePlacement | null
  targetPlacement: HomepagePlacement
  targetOccupied: boolean
}): string | null {
  if (context.currentPlacement === context.targetPlacement) return null

  const currentLabel = context.currentPlacement
    ? homepagePlacementLabels[context.currentPlacement]
    : null
  const targetLabel = homepagePlacementLabels[context.targetPlacement]

  if (currentLabel && context.targetOccupied) {
    return `${currentLabel}에서 ${targetLabel}로 이동하면 ${targetLabel}의 현재 수동 배치가 해제됩니다. 계속할까요?`
  }
  if (currentLabel) return `${currentLabel}에서 ${targetLabel}로 이동할까요?`
  if (context.targetOccupied) return `${targetLabel}의 현재 기사를 이 기사로 교체할까요?`
  return null
}

export async function confirmAndApplyHomepagePlacement(
  context: Parameters<typeof homepagePlacementConfirmationMessage>[0],
  dependencies: { confirm: (message: string) => boolean; apply: () => Promise<void> }
): Promise<'applied' | 'cancelled'> {
  const message = homepagePlacementConfirmationMessage(context)
  if (message && !dependencies.confirm(message)) return 'cancelled'
  await dependencies.apply()
  return 'applied'
}

export function editorialMutationError(result: EditorialMutationStatus) {
  if (result === 'article_not_found') return { status: 404 as const, error: '기사를 찾을 수 없습니다.' }
  if (result === 'article_unpublished') return { status: 409 as const, error: '공개 기사만 Feature로 지정할 수 있습니다.' }
  if (result === 'article_not_featured') return { status: 409 as const, error: 'Feature 기사만 홈페이지에 배치할 수 있습니다.' }
  return null
}

export function toHomepageDeployState(result: DeployHookResult): HeroDeployState {
  if (result.success) return { status: 'triggered', message: '홈페이지 편집 상태가 저장되었고 Cloudflare 재빌드를 요청했습니다.' }
  if (result.cooldown) return { status: 'cooldown', warning: '홈페이지 편집 상태는 저장되었지만 배포 cooldown 중이라 공개 사이트에는 아직 반영되지 않았을 수 있습니다.' }
  return { status: 'failed', warning: '홈페이지 편집 상태는 저장되었지만 Cloudflare 재빌드 요청에 실패했습니다.', error: result.error ?? '알 수 없는 deploy hook 오류' }
}

export function resolveHomepageUnpublishOutcome(
  context: { wasPinnedHero: boolean; wasFeature: boolean },
  result: DeployHookResult,
  currentDeploy: HeroDeployState | null
): { deploy: HeroDeployState | null; reloadHero: boolean; reloadEditorial: boolean } {
  if (context.wasPinnedHero) {
    const heroOutcome = resolveHeroUnpublishOutcome(true, result, currentDeploy)
    return { ...heroOutcome, reloadEditorial: true }
  }

  if (context.wasFeature) {
    return {
      deploy: toHomepageDeployState(result),
      reloadHero: false,
      reloadEditorial: true,
    }
  }

  return {
    deploy: currentDeploy,
    reloadHero: false,
    reloadEditorial: false,
  }
}

export async function applyEditorialMutation(
  mutate: () => Promise<EditorialMutationResult>,
  triggerDeploy: () => Promise<DeployHookResult>
) {
  const mutation = await mutate()
  return {
    mutation,
    deploy: mutation.changed ? toHomepageDeployState(await triggerDeploy()) : { status: 'not_required' as const },
  }
}

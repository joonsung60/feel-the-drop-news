import type { DeployHookResult } from '@/lib/deploy-hook'

export type HeroMutationStatus =
  | 'updated'
  | 'unchanged'
  | 'article_not_found'
  | 'article_unpublished'

export type HeroMutationResult = {
  result: HeroMutationStatus
  articleId: string | null
  changed: boolean
  updatedAt: string | null
}

export type HeroDeployState =
  | { status: 'triggered'; message: string }
  | { status: 'cooldown'; warning: string }
  | { status: 'failed'; warning: string; error: string }
  | { status: 'not_required' }

export function isValidArticleId(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export function heroMutationError(result: HeroMutationStatus): {
  status: 404 | 409
  error: string
} | null {
  if (result === 'article_not_found') {
    return { status: 404, error: '기사를 찾을 수 없습니다.' }
  }
  if (result === 'article_unpublished') {
    return { status: 409, error: '공개 기사만 Hero로 지정할 수 있습니다.' }
  }
  return null
}

export function toHeroDeployState(result: DeployHookResult): HeroDeployState {
  if (result.success) {
    return {
      status: 'triggered',
      message: 'Hero가 저장되었고 Cloudflare 재빌드를 요청했습니다.',
    }
  }
  if (result.cooldown) {
    return {
      status: 'cooldown',
      warning: 'Hero는 저장되었지만 배포 cooldown 중이라 공개 사이트에는 아직 반영되지 않았을 수 있습니다.',
    }
  }
  return {
    status: 'failed',
    warning: 'Hero는 저장되었지만 Cloudflare 재빌드 요청에 실패했습니다.',
    error: result.error ?? '알 수 없는 deploy hook 오류',
  }
}

export function resolveHeroUnpublishOutcome(
  wasPinnedHero: boolean,
  result: DeployHookResult,
  currentDeploy: HeroDeployState | null
): { deploy: HeroDeployState | null; reloadHero: boolean } {
  if (!wasPinnedHero) return { deploy: currentDeploy, reloadHero: false }

  if (result.success) {
    return {
      deploy: {
        status: 'triggered',
        message: 'Hero 자동 해제가 저장되었고 Cloudflare 재빌드를 요청했습니다.',
      },
      reloadHero: true,
    }
  }

  if (result.cooldown) {
    return {
      deploy: {
        status: 'cooldown',
        warning: 'Hero 자동 해제는 저장되었지만 배포 cooldown 중이라 공개 사이트에는 아직 반영되지 않았을 수 있습니다.',
      },
      reloadHero: true,
    }
  }

  return {
    deploy: {
      status: 'failed',
      warning: 'Hero 자동 해제는 저장되었지만 Cloudflare 재빌드 요청에 실패했습니다.',
      error: result.error ?? '알 수 없는 deploy hook 오류',
    },
    reloadHero: true,
  }
}

export async function applyHeroMutation(
  articleId: string | null,
  dependencies: {
    setHero: (articleId: string | null) => Promise<HeroMutationResult>
    triggerDeploy: () => Promise<DeployHookResult>
  }
): Promise<{ mutation: HeroMutationResult; deploy: HeroDeployState }> {
  const mutation = await dependencies.setHero(articleId)
  if (!mutation.changed) {
    return { mutation, deploy: { status: 'not_required' } }
  }

  return {
    mutation,
    deploy: toHeroDeployState(await dependencies.triggerDeploy()),
  }
}

import type { DeployHookResult } from '@/lib/deploy-hook'

type MutationResult<T> = {
  data: T | null
  error: { message: string } | null
}

export async function completeArticleUnpublish<T>(dependencies: {
  updateArticle: () => Promise<MutationResult<T>>
  triggerDeploy: () => Promise<DeployHookResult>
}): Promise<{
  article: T | null
  error: string | null
  deploy: DeployHookResult | null
}> {
  const mutation = await dependencies.updateArticle()
  if (mutation.error) {
    return { article: null, error: mutation.error.message, deploy: null }
  }

  return {
    article: mutation.data,
    error: null,
    deploy: await dependencies.triggerDeploy(),
  }
}


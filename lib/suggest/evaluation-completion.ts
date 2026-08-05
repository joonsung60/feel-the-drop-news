export type PoolEvaluationCompletion = {
  checkedArticleIds: string[]
  retryableArticleIds: string[]
}

export function resolvePoolEvaluationCompletion(
  poolArticleIds: string[],
  failedLlmArticleIds: Iterable<string>,
  allLlmBatchesFailed: boolean,
): PoolEvaluationCompletion {
  const uniquePoolIds = Array.from(new Set(poolArticleIds))
  if (allLlmBatchesFailed) {
    return {
      checkedArticleIds: [],
      retryableArticleIds: uniquePoolIds,
    }
  }

  const poolIdSet = new Set(uniquePoolIds)
  const retryableIdSet = new Set(
    [...failedLlmArticleIds].filter((id) => poolIdSet.has(id)),
  )
  return {
    checkedArticleIds: uniquePoolIds.filter((id) => !retryableIdSet.has(id)),
    retryableArticleIds: uniquePoolIds.filter((id) => retryableIdSet.has(id)),
  }
}

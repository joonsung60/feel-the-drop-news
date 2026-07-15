const CLOUDFLARE_GRAPHQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql'
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

type CloudflareAnalyticsResponse = {
  data?: {
    viewer?: {
      accounts?: Array<{
        rumPageloadEventsAdaptiveGroups?: Array<{
          count?: number
          dimensions?: { requestPath?: string | null }
        }>
      }>
    }
  }
  errors?: unknown[]
}

export type PageView = {
  path: string
  views: number
}

export async function fetchPageViews(): Promise<PageView[]> {
  const accountTag = process.env.CF_ACCOUNT_ID
  const apiToken = process.env.CF_API_TOKEN
  const siteTag = process.env.CF_WEB_ANALYTICS_SITE_TAG
  const missing = [
    ['CF_ACCOUNT_ID', accountTag],
    ['CF_API_TOKEN', apiToken],
    ['CF_WEB_ANALYTICS_SITE_TAG', siteTag],
  ].filter(([, value]) => !value).map(([name]) => name)

  if (missing.length > 0) {
    console.warn(`[Cloudflare Analytics] 환경변수 누락: ${missing.join(', ')}`)
    return []
  }

  const query = `
    query PageViews($accountTag: string!, $siteTag: string!, $since: Time!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          rumPageloadEventsAdaptiveGroups(
            filter: { siteTag: $siteTag, datetime_geq: $since }
            limit: 500
            orderBy: [count_DESC]
          ) {
            count
            dimensions { requestPath }
          }
        }
      }
    }
  `

  try {
    const response = await fetch(CLOUDFLARE_GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: {
          accountTag,
          siteTag,
          since: new Date(Date.now() - THIRTY_DAYS_MS).toISOString(),
        },
      }),
      signal: AbortSignal.timeout(20000),
    })
    const responseText = await response.text()

    if (!response.ok) {
      console.error(`[Cloudflare Analytics] HTTP ${response.status}: ${responseText}`)
      return []
    }

    const payload = JSON.parse(responseText) as CloudflareAnalyticsResponse
    if (payload.errors?.length) {
      console.error('[Cloudflare Analytics] GraphQL errors:', JSON.stringify(payload.errors))
      return []
    }

    return (payload.data?.viewer?.accounts ?? []).flatMap((account) =>
      (account.rumPageloadEventsAdaptiveGroups ?? []).flatMap((group) => {
        const path = group.dimensions?.requestPath
        const views = group.count
        return typeof path === 'string' && typeof views === 'number'
          ? [{ path, views }]
          : []
      })
    )
  } catch (error) {
    console.error('[Cloudflare Analytics] 조회 실패:', error)
    return []
  }
}

# Editorial CMS API boundary note

Milestone 1 adds only the authenticated read endpoint
`GET /api/admin/articles/[id]/preview`. It validates the signed admin cookie in
the route handler through `lib/admin-api-auth.ts`; `proxy.ts` remains a UX
redirect and is not the authorization boundary.

Existing article mutations are intentionally unchanged in this milestone:

- `app/admin/page.tsx` calls the single publish, update, unpublish, delete, and
  image routes.
- `bot/index.ts` calls article update/delete/publish and batch publish routes.
- `app/api/daily-pipeline/[runId]/items/[displayOrder]/route.ts` invokes the
  shared draft-delete service directly.
- `app/api/articles/[id]/publish/route.ts` and batch publish both reuse
  `lib/publish-service.ts`; Daily Pipeline suppresses per-item deploys and uses
  its final deploy orchestration.

Consequently, applying admin-cookie authentication to all existing `/api/articles`
routes would break non-browser callers. A later milestone must either give bot
and worker callers a separate service credential or introduce authenticated
`/api/admin/...` wrappers while retaining explicitly scoped internal routes.

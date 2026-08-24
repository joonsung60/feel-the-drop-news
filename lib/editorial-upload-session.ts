import type { ArticleBlockDocument } from '@/lib/article-blocks'
import { collectManagedEditorialPaths } from '@/lib/editorial-media'

export type DeleteEditorialUpload = (path: string) => Promise<boolean>

type PendingUpload = {
  path: string
  generation: number
}

export class EditorialUploadSession {
  private readonly pending = new Map<string, number>()
  private cleanupChain: Promise<void> = Promise.resolve()
  private latestReferenced = new Set<string>()
  private generation = 0

  register(path: string): void {
    this.pending.set(path, ++this.generation)
  }

  list(): string[] {
    return [...this.pending.keys()]
  }

  async reconcile(
    document: ArticleBlockDocument,
    coverPath: string | null,
    deleteUpload: DeleteEditorialUpload
  ): Promise<void> {
    const referenced = collectManagedEditorialPaths(document, coverPath)
    this.latestReferenced = referenced
    const unused = this.snapshotPending().filter(({ path }) => !referenced.has(path))
    return this.enqueueCleanup(async () => {
      await this.deletePaths(unused, deleteUpload)
    })
  }

  async finishSave(
    document: ArticleBlockDocument,
    coverPath: string | null,
    deleteUpload: DeleteEditorialUpload
  ): Promise<void> {
    const referenced = collectManagedEditorialPaths(document, coverPath)
    this.latestReferenced = referenced
    const snapshot = this.snapshotPending()
    const unused = snapshot.filter(({ path }) => !referenced.has(path))
    return this.enqueueCleanup(async () => {
      await this.deletePaths(unused, deleteUpload)
      this.releaseSnapshot(snapshot)
    })
  }

  async abandon(deleteUpload: DeleteEditorialUpload): Promise<void> {
    this.latestReferenced = new Set()
    const snapshot = this.snapshotPending()
    return this.enqueueCleanup(async () => {
      await this.deletePaths(snapshot, deleteUpload)
      this.releaseSnapshot(snapshot)
    })
  }

  private enqueueCleanup(cleanup: () => Promise<void>): Promise<void> {
    this.cleanupChain = this.cleanupChain.then(cleanup, cleanup)
    return this.cleanupChain
  }

  private snapshotPending(): PendingUpload[] {
    return [...this.pending].map(([path, generation]) => ({ path, generation }))
  }

  private isCurrent(upload: PendingUpload): boolean {
    return this.pending.get(upload.path) === upload.generation
  }

  private releaseSnapshot(snapshot: PendingUpload[]): void {
    for (const upload of snapshot) {
      if (this.isCurrent(upload)) this.pending.delete(upload.path)
    }
  }

  private async deletePaths(uploads: PendingUpload[], deleteUpload: DeleteEditorialUpload): Promise<void> {
    await Promise.all(uploads.map(async (upload) => {
      if (!this.isCurrent(upload) || this.latestReferenced.has(upload.path)) return
      try {
        if (await deleteUpload(upload.path) && this.isCurrent(upload)) {
          this.pending.delete(upload.path)
        }
      } catch {
        // Session cleanup is best-effort; server-side reference checks remain authoritative.
      }
    }))
  }
}

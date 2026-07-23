import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export type PipelineName = 'collect' | 'suggest' | 'correspondent'

export type PipelineEvent = {
  ts: string
  run_id: string
  pipeline: PipelineName
  stage: string
  reason: string | null
  source: string | null
  item_url: string | null
  title: string | null
  detail: Record<string, unknown>
}

type EventInput = Omit<PipelineEvent, 'ts' | 'run_id' | 'pipeline'>

export class PipelineObserver {
  readonly runId: string
  readonly filePath: string
  private warned = false

  constructor(
    readonly pipeline: PipelineName,
    private readonly logRoot = path.join(process.cwd(), 'logs'),
  ) {
    const startedAt = new Date().toISOString()
    this.runId = `${pipeline}-${startedAt}-${randomUUID().slice(0, 8)}`
    this.filePath = path.join(logRoot, `${startedAt}_${pipeline}.jsonl`)
  }

  event(input: EventInput): void {
    const event: PipelineEvent = {
      ts: new Date().toISOString(),
      run_id: this.runId,
      pipeline: this.pipeline,
      stage: input.stage,
      reason: input.reason,
      source: input.source,
      item_url: input.item_url,
      title: input.title,
      detail: input.detail,
    }

    try {
      fs.mkdirSync(this.logRoot, { recursive: true })
      fs.appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, 'utf8')
    } catch (error) {
      this.warnOnce(error)
    }
  }

  saveRaw(content: string): string | null {
    try {
      const digest = createHash('sha256').update(content).digest('hex')
      const rawDir = path.join(this.logRoot, 'raw', this.runId)
      const rawPath = path.join(rawDir, `${digest}.txt`)
      fs.mkdirSync(rawDir, { recursive: true })
      if (!fs.existsSync(rawPath)) fs.writeFileSync(rawPath, content, 'utf8')
      return path.relative(process.cwd(), rawPath).split(path.sep).join('/')
    } catch (error) {
      this.warnOnce(error)
      return null
    }
  }

  private warnOnce(error: unknown): void {
    if (this.warned) return
    this.warned = true
    console.error(`[pipeline-observer:${this.pipeline}] logging disabled for this run:`, String(error))
  }
}

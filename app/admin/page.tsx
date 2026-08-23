'use client'

import { useCallback, useEffect, useState } from 'react'
import type { PercentCrop } from 'react-image-crop'
import { ImageCropper, getCroppedDataUrl } from '@/components/ImageCropper'
import { ArticleRenderer } from '@/components/ArticleRenderer'
import { EditorialArticleEditor } from '@/components/EditorialArticleEditor'
import { supabase } from '@/lib/supabase'

type AdminGroup = 'rss' | 'image' | 'interview'
type RssTab = 'collect' | 'add-urls' | 'suggest' | 'articles' | 'cluster' | 'generate'
type ImageTab = 'image-source' | 'text-source' | 'image-articles'
type InterviewTab = 'discovery' | 'review'

const RSS_TABS: { id: RssTab; label: string }[] = [
  { id: 'collect', label: '① RSS 수집' },
  { id: 'add-urls', label: '② URL 직접 추가' },
  { id: 'suggest', label: '③ 자동 토픽 제안' },
  { id: 'articles', label: '④ 생성 기사 검토' },
  { id: 'cluster', label: '⑤ 클러스터 (수동)' },
  { id: 'generate', label: '⑥ 기사 생성 (수동)' },
]

const IMAGE_TABS: { id: ImageTab; label: string }[] = [
  { id: 'image-source', label: '이미지 소스 추가' },
  { id: 'text-source', label: '텍스트 소스 추가' },
  { id: 'image-articles', label: '생성 기사 검토' },
]

const INTERVIEW_TABS: { id: InterviewTab; label: string }[] = [
  { id: 'discovery', label: '인터뷰 후보 발굴' },
  { id: 'review', label: '생성 기사 검토' },
]

type JobPollResult = {
  status: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any
  error_message: string | null
}

async function pollJobStatus(jobId: string): Promise<JobPollResult> {
  const POLL_INTERVAL_MS = 3000
  const TIMEOUT_MS = 300_000
  const deadline = Date.now() + TIMEOUT_MS

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    try {
      const res = await fetch(`/api/jobs?id=${encodeURIComponent(jobId)}`)
      const data = await res.json().catch(() => ({}))
      if (data?.status === 'done' || data?.status === 'failed') {
        return {
          status: data.status,
          result: data.result ?? null,
          error_message: data.error_message ?? null,
        }
      }
    } catch {
      // 일시적 오류는 무시하고 다음 폴링까지 대기
    }
  }

  return { status: 'timeout', result: null, error_message: '시간 초과' }
}

export default function AdminPage() {
  const [activeGroup, setActiveGroup] = useState<AdminGroup>('rss')
  const [activeRssTab, setActiveRssTab] = useState<RssTab>('collect')
  const [activeImageTab, setActiveImageTab] = useState<ImageTab>('image-source')
  const [activeInterviewTab, setActiveInterviewTab] = useState<InterviewTab>('discovery')
  const [preferredIngestionRunId, setPreferredIngestionRunId] = useState<string | null>(null)

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-8">FEEL THE DROP 어드민</h1>

      <div className="mb-8 rounded border border-gray-200 bg-gray-50 p-1">
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
          {[
            { id: 'rss', label: 'RSS 및 URL 기반 기사 생성' },
            { id: 'image', label: '이미지 소스 및 SNS 기반 기사 생성' },
            { id: 'interview', label: '인터뷰 번역' },
          ].map((group) => (
            <button
              key={group.id}
              type="button"
              onClick={() => setActiveGroup(group.id as AdminGroup)}
              className={`rounded px-4 py-3 text-sm font-semibold transition-colors ${
                activeGroup === group.id
                  ? 'bg-white text-black shadow-sm'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {group.label}
            </button>
          ))}
        </div>
      </div>

      {activeGroup === 'rss' && (
        <TabBar
          tabs={RSS_TABS}
          activeId={activeRssTab}
          onChange={(id) => setActiveRssTab(id as RssTab)}
        />
      )}

      {activeGroup === 'image' && (
        <TabBar
          tabs={IMAGE_TABS}
          activeId={activeImageTab}
          onChange={(id) => setActiveImageTab(id as ImageTab)}
        />
      )}

      {activeGroup === 'interview' && (
        <TabBar
          tabs={INTERVIEW_TABS}
          activeId={activeInterviewTab}
          onChange={(id) => setActiveInterviewTab(id as InterviewTab)}
        />
      )}

      {activeGroup === 'rss' && activeRssTab === 'collect' && (
        <CollectTab onIngestionRun={setPreferredIngestionRunId} />
      )}
      {activeGroup === 'rss' && activeRssTab === 'add-urls' && (
        <AddUrlsTab onIngestionRun={setPreferredIngestionRunId} />
      )}
      {activeGroup === 'rss' && activeRssTab === 'suggest' && (
        <SuggestTab preferredIngestionRunId={preferredIngestionRunId} />
      )}
      {activeGroup === 'rss' && activeRssTab === 'articles' && <ArticlesReviewTab />}
      {activeGroup === 'rss' && activeRssTab === 'cluster' && <ClusterTab />}
      {activeGroup === 'rss' && activeRssTab === 'generate' && <GenerateTab />}

      {activeGroup === 'image' && activeImageTab === 'image-source' && <ImageSourceTab />}
      {activeGroup === 'image' && activeImageTab === 'text-source' && <TextSourceTab />}
      {activeGroup === 'image' && activeImageTab === 'image-articles' && <ArticlesReviewTab />}

      {activeGroup === 'interview' && activeInterviewTab === 'discovery' && <InterviewDiscoveryTab />}
      {activeGroup === 'interview' && activeInterviewTab === 'review' && <ArticlesReviewTab />}
    </div>
  )
}

function TabBar<T extends string>({
  tabs,
  activeId,
  onChange,
}: {
  tabs: { id: T; label: string }[]
  activeId: T
  onChange: (id: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-2 mb-8 border-b">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeId === tab.id
              ? 'border-black text-black'
              : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('이미지를 읽지 못했습니다.'))
      }
    }
    reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'))
    reader.readAsDataURL(file)
  })
}

function CollectTab({
  onIngestionRun,
}: {
  onIngestionRun: (runId: string) => void
}) {
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<string>('')
  const [failures, setFailures] = useState<{ source: string; url: string; error: string }[]>([])
  const [activeCount, setActiveCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('rss_sources')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .then(({ count, error }) => {
        if (cancelled) return
        if (error || count === null) {
          setActiveCount(-1)
          return
        }
        setActiveCount(count)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleCollect = async () => {
    setIsLoading(true)
    setResult('')
    setFailures([])
    try {
      const res = await fetch('/api/collect', { method: 'POST' })
      const data = await res.json()
      if (typeof data.ingestionRunId === 'string') onIngestionRun(data.ingestionRunId)
      setResult(`수집 완료: ${data.collected}개 기사 저장됨`)
      setFailures(data.failures ?? [])
    } catch {
      setResult('오류가 발생했습니다.')
    }
    setIsLoading(false)
  }

  const countLabel =
    activeCount === null
      ? '… '
      : activeCount < 0
        ? ''
        : `${activeCount}개 `

  return (
    <div>
      <p className="text-gray-600 mb-6">{countLabel}RSS 소스에서 새 기사를 수집합니다.</p>
      <button
        onClick={handleCollect}
        disabled={isLoading}
        className="px-6 py-3 bg-black text-white rounded font-semibold disabled:opacity-50"
      >
        {isLoading ? '수집 중...' : 'RSS 수집 실행'}
      </button>
      {result && <p className="mt-4 text-green-600">{result}</p>}
      {failures.length > 0 && (
        <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-4">
          <p className="font-semibold text-amber-900">실패 RSS 소스 {failures.length}개</p>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {failures.map((failure) => (
              <li key={`${failure.source}-${failure.url}`}>
                <span className="font-medium">{failure.source}</span>: {failure.error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function AddUrlsTab({
  onIngestionRun,
}: {
  onIngestionRun: (runId: string) => void
}) {
  const [urls, setUrls] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<string>('')

  const handleAdd = async () => {
    const urlList = urls.split('\n').map(u => u.trim()).filter(u => u.length > 0)
    if (urlList.length === 0) return

    setIsLoading(true)
    setResult('')
    try {
      const res = await fetch('/api/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: urlList }),
      })
      const data = await res.json()
      if (typeof data.ingestionRunId === 'string') onIngestionRun(data.ingestionRunId)
      setResult(`${data.collected}개 기사가 DB에 추가됐습니다.`)
      setUrls('')
    } catch {
      setResult('오류가 발생했습니다.')
    }
    setIsLoading(false)
  }

  return (
    <div>
      <p className="text-gray-600 mb-4">URL을 한 줄에 하나씩 붙여넣으세요.</p>
      <textarea
        className="w-full h-48 p-4 border rounded font-mono text-sm mb-4"
        placeholder="https://mixmag.net/article/...&#10;https://ra.co/articles/..."
        value={urls}
        onChange={(e) => setUrls(e.target.value)}
      />
      <button
        onClick={handleAdd}
        disabled={isLoading}
        className="px-6 py-3 bg-black text-white rounded font-semibold disabled:opacity-50"
      >
        {isLoading ? '추가 중...' : 'URL 추가'}
      </button>
      {result && <p className="mt-4 text-green-600">{result}</p>}
    </div>
  )
}

function ImageSourceTab() {
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [sourceImageDataUrl, setSourceImageDataUrl] = useState('')
  const [useCrop, setUseCrop] = useState(false)
  const [crop, setCrop] = useState<PercentCrop | null>(null)
  const [sourceMemo, setSourceMemo] = useState('')
  const [sourceDate, setSourceDate] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [imageSourceId, setImageSourceId] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState('')
  const [extractedText, setExtractedText] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const resetResult = () => {
    setImageSourceId(null)
    setImageUrl('')
    setExtractedText('')
    setUseCrop(false)
    setCrop(null)
    setMessage('')
    setError('')
  }

  const handleAnalyze = async () => {
    if (!imageFile) {
      setError('분석할 이미지를 선택하세요.')
      return
    }

    setIsAnalyzing(true)
    resetResult()

    try {
      const imageBase64 = await fileToDataUrl(imageFile)
      setSourceImageDataUrl(imageBase64)
      const res = await fetch('/api/image-sources/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          fileName: imageFile.name,
          mimeType: imageFile.type,
          sourceMemo,
          sourceDate,
        }),
      })
      const data = await res.json()

      if (data.error) {
        setError(data.error)
      } else {
        setImageSourceId(data.imageSource?.id ?? null)
        setImageUrl(data.imageUrl ?? data.imageSource?.image_url ?? '')
        setExtractedText(data.extractedText ?? data.imageSource?.extracted_text ?? '')
        setMessage('이미지 분석이 완료됐습니다. 내용을 확인한 뒤 기사 초안을 생성하세요.')
      }
    } catch (err) {
      setError(String(err))
    }

    setIsAnalyzing(false)
  }

  const handleGenerateDraft = async () => {
    if (!imageSourceId) {
      setError('먼저 이미지를 분석하세요.')
      return
    }

    setIsGenerating(true)
    setError('')
    setMessage('')

    try {
      const croppedImageBase64 = useCrop && sourceImageDataUrl && crop
        ? await getCroppedDataUrl(sourceImageDataUrl, crop)
        : undefined
      const res = await fetch(`/api/image-sources/${imageSourceId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: croppedImageBase64,
          mimeType: 'image/jpeg',
        }),
      })
      const data = await res.json()

      if (data.error) {
        setError(data.error)
      } else {
        setMessage(`기사 초안 생성 완료: ${data.article?.title ?? ''}`)
        setImageSourceId(null)
      }
    } catch (err) {
      setError(String(err))
    }

    setIsGenerating(false)
  }

  const handleRejectImageSource = async () => {
    if (!imageSourceId) return

    setIsGenerating(true)
    setError('')
    setMessage('')

    try {
      const res = await fetch(`/api/image-sources/${imageSourceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' }),
      })
      const data = await res.json()

      if (data.error) {
        setError(data.error)
      } else {
        setMessage('이미지 소스를 기각했습니다.')
        setImageSourceId(null)
      }
    } catch (err) {
      setError(String(err))
    }

    setIsGenerating(false)
  }

  return (
    <div>
      <p className="text-gray-600 mb-6">
        SNS 캡처나 포스터 이미지를 Vision LLM으로 분석하고, 단일 이미지 소스 기반 기사 초안을 생성합니다.
      </p>

      <div className="space-y-5 rounded border p-5">
        <div>
          <label className="mb-2 block text-sm font-semibold text-gray-800">
            이미지 파일
          </label>
          <input
            type="file"
            accept="image/jpeg,image/png"
            onChange={(e) => {
              setImageFile(e.target.files?.[0] ?? null)
              setSourceImageDataUrl('')
              resetResult()
            }}
            className="block w-full rounded border p-3 text-sm file:mr-4 file:rounded file:border-0 file:bg-black file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
          />
          {imageFile && (
            <p className="mt-2 text-sm text-gray-500">
              선택됨: {imageFile.name}
            </p>
          )}
        </div>

        <div>
          <label className="mb-2 block text-sm font-semibold text-gray-800">
            소스 메모
            <span className="ml-1 font-normal text-gray-400">(선택)</span>
          </label>
          <textarea
            value={sourceMemo}
            onChange={(e) => setSourceMemo(e.target.value)}
            className="h-32 w-full rounded border p-3 text-sm"
            placeholder="예: Instagram 캡처, 아티스트 공식 계정 게시물, 현장 포스터 등"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-semibold text-gray-800">
            날짜
            <span className="ml-1 font-normal text-gray-400">(선택)</span>
          </label>
          <input
            type="date"
            value={sourceDate}
            onChange={(e) => setSourceDate(e.target.value)}
            className="w-full rounded border p-3 text-sm sm:w-64"
          />
        </div>

        <div className="rounded bg-gray-50 p-4 text-sm text-gray-500">
          이미지는 Supabase Storage에 저장되고, 분석 결과를 확인한 뒤 기사 초안을 생성할 수 있습니다.
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={isAnalyzing || isGenerating || !imageFile}
            className="px-6 py-3 bg-black text-white rounded font-semibold disabled:opacity-50"
          >
            {isAnalyzing ? '분석 중...' : '분석'}
          </button>
          {imageSourceId && (
            <>
              <button
                type="button"
                onClick={handleGenerateDraft}
                disabled={isGenerating || isAnalyzing}
                className="px-6 py-3 border border-gray-300 text-gray-700 rounded font-semibold hover:bg-gray-50 disabled:opacity-50"
              >
                {isGenerating ? '처리 중...' : '기사 초안 생성'}
              </button>
              <button
                type="button"
                onClick={handleRejectImageSource}
                disabled={isGenerating || isAnalyzing}
                className="px-6 py-3 border border-red-300 text-red-600 rounded font-semibold hover:bg-red-50 disabled:opacity-50"
              >
                기각
              </button>
            </>
          )}
        </div>

        {message && <p className="text-green-600">{message}</p>}
        {error && <p className="text-red-500">{error}</p>}

        {extractedText && sourceImageDataUrl && (
          <div className="border-t pt-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-800">이미지 크롭</p>
                <p className="mt-1 text-sm text-gray-500">
                  선택사항입니다. 끄면 원본 이미지 전체가 기사 이미지로 들어갑니다.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={useCrop}
                  onChange={(e) => {
                    setUseCrop(e.target.checked)
                    if (!e.target.checked) setCrop(null)
                  }}
                />
                크롭 사용
              </label>
            </div>
            {useCrop ? (
              <ImageCropper
                imageUrl={sourceImageDataUrl}
                onCropChange={setCrop}
              />
            ) : (
              <div className="max-h-[420px] overflow-hidden rounded border bg-gray-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sourceImageDataUrl} alt="" className="block max-h-[420px] w-full object-contain" />
              </div>
            )}
          </div>
        )}

        {(imageUrl || extractedText) && (
          <div className="grid grid-cols-1 gap-5 border-t pt-5 md:grid-cols-[220px_1fr]">
            {imageUrl && (
              <div>
                <p className="mb-2 text-sm font-semibold text-gray-800">원본 저장 이미지</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl}
                  alt=""
                  className="w-full rounded border bg-gray-100 object-cover"
                />
              </div>
            )}
            {extractedText && (
              <div>
                <p className="mb-2 text-sm font-semibold text-gray-800">분석 결과 미리보기</p>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded border bg-gray-50 p-4 text-sm leading-6 text-gray-700">
                  {extractedText}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ClusterTab() {
  const [topic, setTopic] = useState('')
  const [keywords, setKeywords] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<string>('')

  const handleCluster = async () => {
    if (!topic) return
    setIsLoading(true)
    setResult('')
    try {
      const res = await fetch('/api/cluster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          keywords: keywords.split(',').map(k => k.trim()).filter(k => k.length > 0),
          matchMode: 'or',
        }),
      })
      const data = await res.json()
      setResult(`클러스터 생성 완료: ${data.clusterId} (${data.matched}개 기사 매칭)`)
      setTopic('')
      setKeywords('')
    } catch {
      setResult('오류가 발생했습니다.')
    }
    setIsLoading(false)
  }

  return (
    <div>
      <p className="text-gray-600 mb-6">토픽과 키워드를 입력하면 관련 기사들을 자동으로 묶습니다.</p>
      <input
        className="w-full p-3 border rounded mb-4"
        placeholder="토픽 (예: Martin Garrix 2026 신곡 발표)"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
      />
      <input
        className="w-full p-3 border rounded mb-4"
        placeholder="키워드 (쉼표로 구분, 예: Martin Garrix, STMPD, new single)"
        value={keywords}
        onChange={(e) => setKeywords(e.target.value)}
      />
      <button
        onClick={handleCluster}
        disabled={isLoading}
        className="px-6 py-3 bg-black text-white rounded font-semibold disabled:opacity-50"
      >
        {isLoading ? '클러스터 생성 중...' : '클러스터 생성'}
      </button>
      {result && <p className="mt-4 text-green-600">{result}</p>}
    </div>
  )
}

type SuggestionStatus = 'pending' | 'approved' | 'rejected' | 'published'
type SubTab = 'pending' | 'published' | 'rejected'

type PersistedSuggestion = {
  id: string
  topic: string
  keywords: string[]
  articleIds: string[]
  reason?: string
  commonEntities?: string[]
  cohesionScore?: number
  articles: { id: string; title: string; url: string }[]
  status: SuggestionStatus
  clusterId: string | null
  articleId: string | null
  createdAt: string
}

type ProcessingState = { state: 'pending' | 'success' | 'error'; message: string }

type TopicBlockRule = {
  id: string
  pattern: string
  reason: string | null
  enabled: boolean
  created_at: string
}

type AdminArticle = {
  id: string
  slug: string | null
  title: string
  content: string
  content_blocks?: unknown | null
  published: boolean
  published_at: string | null
  created_at: string
  updated_at: string | null
  cluster_id: string | null
  image_url: string | null
  category: string | null
  genre: string | null
}

type ArticlePreviewPayload = {
  article: AdminArticle
  leadingImageUrl: string | null
}

type GenerateResult = {
  success: boolean
  article?: {
    id?: string
    title: string
    content: string
  }
  error?: string
}

function SuggestTab({
  preferredIngestionRunId,
}: {
  preferredIngestionRunId: string | null
}) {
  const [subTab, setSubTab] = useState<SubTab>('pending')
  const [suggestions, setSuggestions] = useState<PersistedSuggestion[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState('')
  const [processingIds, setProcessingIds] = useState<Set<string>>(() => new Set())
  const [results, setResults] = useState<Record<string, ProcessingState>>({})
  const [lastGenSummary, setLastGenSummary] = useState('')

  const startProcessing = (id: string) => {
    setProcessingIds((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }

  const stopProcessing = (id: string) => {
    setProcessingIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }
  const [blockRules, setBlockRules] = useState<TopicBlockRule[]>([])
  const [blockPattern, setBlockPattern] = useState('')
  const [blockReason, setBlockReason] = useState('')
  const [blockMessage, setBlockMessage] = useState('')
  const [isBlocklistLoading, setIsBlocklistLoading] = useState(false)
  const [isExtendedGenerating, setIsExtendedGenerating] = useState(false)
  const [extendedMessage, setExtendedMessage] = useState('')
  const [suggestLimit, setSuggestLimit] = useState<number>(100)
  const [suggestExtendedLimit, setSuggestExtendedLimit] = useState<number>(100)

  const load = useCallback(async (status: SubTab) => {
    setIsLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/suggest-clusters?status=${status}`)
      const data = await res.json()
      if (data.error) {
        setError(data.error)
        setSuggestions([])
      } else {
        setSuggestions((data.suggestions ?? []) as PersistedSuggestion[])
      }
    } catch {
      setError('목록을 불러오지 못했습니다.')
      setSuggestions([])
    }
    setIsLoading(false)
  }, [])

  const loadBlockRules = useCallback(async () => {
    setIsBlocklistLoading(true)
    setBlockMessage('')
    try {
      const res = await fetch('/api/topic-suggestion-blocklist')
      const data = await res.json()
      if (data.error) {
        setBlockMessage(data.error)
        setBlockRules([])
      } else {
        setBlockRules((data.rules ?? []) as TopicBlockRule[])
      }
    } catch {
      setBlockMessage('차단 규칙을 불러오지 못했습니다.')
      setBlockRules([])
    }
    setIsBlocklistLoading(false)
  }, [])

  useEffect(() => {
    load(subTab)
  }, [subTab, load])

  useEffect(() => {
    loadBlockRules()
  }, [loadBlockRules])

  const patchStatus = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/suggest-clusters/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.json()
  }

  const handleGenerate = async () => {
    setIsGenerating(true)
    setError('')
    setLastGenSummary('')
    try {
      const res = await fetch('/api/suggest-clusters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          limit: suggestLimit,
          preferredIngestionRunId,
        }),
      })
      const data = await res.json()
      if (data.error) {
        setError(data.error)
      } else {
        const saved = data.saved ?? 0
        const total = data.total ?? 0
        const llmCount = data.llmSuggestionCount ?? 0
        const normalizedCount = data.normalizedSuggestionCount ?? 0
        const modelLabel = data.model ? ` / ${data.model}` : ''
        const sourceLabel =
          data.source === 'fallback' ? ' (자동 보정)' : data.source === 'llm' ? ' (LLM)' : ''
        const debugLabel = ` / LLM ${llmCount}개, 통과 ${normalizedCount}개${modelLabel}`
        setLastGenSummary(`${total}개 기사 분석 → ${saved}개 신규 제안 저장${sourceLabel}${debugLabel}`)
        if (saved === 0 && data.rawResponsePreview) {
          setError(`LLM 원 응답 미리보기: ${data.rawResponsePreview}`)
        }
        if (subTab === 'pending') {
          await load('pending')
        } else {
          setSubTab('pending')
        }
      }
    } catch {
      setError('오류가 발생했습니다.')
    }
    setIsGenerating(false)
  }

  const handleExtendedGenerate = async () => {
    setIsExtendedGenerating(true)
    setExtendedMessage('확장 제안 실행 중... 완료 후 목록을 새로고침하세요.')
    const initialCount = suggestions.length

    try {
      const res = await fetch('/api/suggest-clusters/extended', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.status === 503 && data.code === 'suggest2_rework') {
        setExtendedMessage('Suggest 2는 재설계 중이라 임시 비활성화되어 있습니다. Suggest 1을 이용해 주세요.')
        setIsExtendedGenerating(false)
        return
      }
      if (!res.ok) {
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`)
      }

      let polls = 0
      const poll = async () => {
        polls++
        if (polls > 20) {
          setIsExtendedGenerating(false)
          setExtendedMessage('확장 제안 폴링 종료 (10분 경과).')
          return
        }

        try {
          const res = await fetch('/api/suggest-clusters?status=pending')
          const data = await res.json()
          const currentCount = data.suggestions?.length || 0

          if (currentCount > initialCount) {
            const added = currentCount - initialCount
            setExtendedMessage(`${added}개 추가됨. 새로고침하세요.`)
            setIsExtendedGenerating(false)
            return
          }
        } catch {
          // ignore
        }

        setTimeout(poll, 30000)
      }

      setTimeout(poll, 30000)
    } catch {
      setExtendedMessage('확장 제안 실행 중 오류가 발생했습니다.')
      setIsExtendedGenerating(false)
    }
  }

  const handleDeleteAllPending = async () => {
    const ok = window.confirm(`pending 상태 토픽 제안 ${suggestions.length}개를 모두 삭제하시겠습니까?`)
    if (!ok) return

    setIsGenerating(true)
    setError('')
    try {
      const res = await fetch('/api/suggest-clusters?status=pending', {
        method: 'DELETE'
      })
      const text = await res.text()
      const data = text ? JSON.parse(text) : {}
      if (!res.ok || data.error) {
        setError(data.error ?? `삭제 실패: HTTP ${res.status}`)
        await load('pending')
        return
      }
      setSuggestions([])
      if (data.rawArticleResetError) {
        setError(`pending은 삭제됐지만 raw 기사 초기화 실패: ${data.rawArticleResetError}`)
      }
      await load('pending')
    } catch {
      setError('삭제 중 오류가 발생했습니다.')
    }
    setIsGenerating(false)
  }

  const handleApprove = async (s: PersistedSuggestion) => {
    startProcessing(s.id)
    setResults((r) => ({ ...r, [s.id]: { state: 'pending', message: '잡 등록 중...' } }))

    try {
      const jobRes = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_type: 'generate_from_suggestion',
          payload: { suggestionId: s.id },
        }),
      })
      const jobData = await jobRes.json()
      if (!jobRes.ok || jobData.error || !jobData.jobId) {
        setResults((r) => ({
          ...r,
          [s.id]: { state: 'error', message: jobData.error ?? '잡 등록 실패' },
        }))
        stopProcessing(s.id)
        return
      }

      setResults((r) => ({ ...r, [s.id]: { state: 'pending', message: '기사 생성 중...' } }))

      const poll = await pollJobStatus(jobData.jobId)
      if (poll.status === 'done') {
        const articleTitle =
          (Array.isArray(poll.result) ? poll.result[0]?.article?.title : poll.result?.article?.title) ?? ''
        setResults((r) => ({
          ...r,
          [s.id]: { state: 'success', message: `완료: ${articleTitle}` },
        }))
        await load(subTab)
      } else {
        setResults((r) => ({
          ...r,
          [s.id]: { state: 'error', message: poll.error_message ?? '기사 생성 실패' },
        }))
      }
    } catch (err) {
      setResults((r) => ({ ...r, [s.id]: { state: 'error', message: String(err) } }))
    }
    stopProcessing(s.id)
  }

  const handleReject = async (s: PersistedSuggestion) => {
    startProcessing(s.id)
    try {
      const data = await patchStatus(s.id, { status: 'rejected', hideRawArticles: true })
      if (data.error) {
        setResults((r) => ({ ...r, [s.id]: { state: 'error', message: data.error } }))
      } else {
        await load(subTab)
      }
    } catch (err) {
      setResults((r) => ({ ...r, [s.id]: { state: 'error', message: String(err) } }))
    }
    stopProcessing(s.id)
  }

  const handleAddBlockRule = async () => {
    const pattern = blockPattern.trim()
    if (!pattern) return

    setIsBlocklistLoading(true)
    setBlockMessage('')
    try {
      const res = await fetch('/api/topic-suggestion-blocklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pattern,
          reason: blockReason.trim(),
        }),
      })
      const data = await res.json()
      if (data.error) {
        setBlockMessage(data.error)
      } else {
        setBlockPattern('')
        setBlockReason('')
        setBlockMessage(`차단 규칙 추가: ${data.rule?.pattern ?? pattern}`)
        await loadBlockRules()
      }
    } catch {
      setBlockMessage('차단 규칙 추가 중 오류가 발생했습니다.')
    }
    setIsBlocklistLoading(false)
  }

  const handleToggleBlockRule = async (rule: TopicBlockRule) => {
    setIsBlocklistLoading(true)
    setBlockMessage('')
    try {
      const res = await fetch('/api/topic-suggestion-blocklist', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: rule.id,
          enabled: !rule.enabled,
        }),
      })
      const data = await res.json()
      if (data.error) {
        setBlockMessage(data.error)
      } else {
        await loadBlockRules()
      }
    } catch {
      setBlockMessage('차단 규칙 변경 중 오류가 발생했습니다.')
    }
    setIsBlocklistLoading(false)
  }

  const handleDeleteBlockRule = async (rule: TopicBlockRule) => {
    setIsBlocklistLoading(true)
    setBlockMessage('')
    try {
      const res = await fetch(`/api/topic-suggestion-blocklist?id=${encodeURIComponent(rule.id)}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (data.error) {
        setBlockMessage(data.error)
      } else {
        setBlockMessage(`차단 규칙 삭제: ${rule.pattern}`)
        await loadBlockRules()
      }
    } catch {
      setBlockMessage('차단 규칙 삭제 중 오류가 발생했습니다.')
    }
    setIsBlocklistLoading(false)
  }

  const handleIgnoreArticle = async (suggestionId: string, articleId: string) => {
    try {
      const res = await fetch(`/api/suggest-clusters/${suggestionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawArticleId: articleId }),
      })
      const data = await res.json()
      if (data.success) {
        setSuggestions((prev) =>
          prev.map((s) => {
            if (s.id === suggestionId) {
              return {
                ...s,
                articles: s.articles.filter((a) => a.id !== articleId),
              }
            }
            return s
          })
        )
      } else {
        console.error('Ignore error:', data.error)
      }
    } catch (err) {
      console.error('Ignore request failed:', err)
    }
  }

  const emptyMessage =
    subTab === 'pending'
      ? '대기 중인 제안이 없습니다. 위 버튼으로 새 제안을 받아보세요.'
      : subTab === 'published'
      ? '기사 생성 완료된 제안이 아직 없습니다.'
      : '거절된 제안이 없습니다.'

  return (
    <div>
      <p className="text-gray-600 mb-6">
        최근 미사용 raw 기사를 LLM이 분석해 토픽 그룹을 제안합니다. 승인하면 기사 초안이 생성되고, 게시는 다음 탭에서 검토 후 진행합니다.
      </p>

      <section className="mb-6 border rounded p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">토픽 제안 차단 규칙</h2>
            <p className="mt-1 text-sm text-gray-500">토픽, 키워드, 공통 근거에 포함되면 저장하지 않습니다.</p>
          </div>
          <button
            type="button"
            onClick={loadBlockRules}
            disabled={isBlocklistLoading}
            className="px-3 py-2 border border-gray-300 text-sm rounded font-semibold disabled:opacity-50"
          >
            새로고침
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            className="rounded border p-3 text-sm"
            placeholder="차단 키워드 (예: catches up with)"
            value={blockPattern}
            onChange={(e) => setBlockPattern(e.target.value)}
          />
          <input
            className="rounded border p-3 text-sm"
            placeholder="메모 (선택)"
            value={blockReason}
            onChange={(e) => setBlockReason(e.target.value)}
          />
          <button
            type="button"
            onClick={handleAddBlockRule}
            disabled={isBlocklistLoading || !blockPattern.trim()}
            className="px-4 py-3 bg-black text-white text-sm rounded font-semibold disabled:opacity-50"
          >
            추가
          </button>
        </div>

        {blockMessage && <p className="mt-3 text-sm text-gray-500">{blockMessage}</p>}

        {blockRules.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {blockRules.map((rule) => (
              <div
                key={rule.id}
                className={`flex items-center gap-2 rounded border px-3 py-2 text-sm ${
                  rule.enabled ? 'border-gray-300' : 'border-gray-200 text-gray-400'
                }`}
              >
                <span className="font-medium">{rule.pattern}</span>
                {rule.reason && <span className="text-xs text-gray-500">{rule.reason}</span>}
                <button
                  type="button"
                  onClick={() => handleToggleBlockRule(rule)}
                  disabled={isBlocklistLoading}
                  className="text-xs text-gray-500 hover:text-black disabled:opacity-50"
                >
                  {rule.enabled ? '끄기' : '켜기'}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteBlockRule(rule)}
                  disabled={isBlocklistLoading}
                  className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <select
          value={suggestLimit}
          onChange={(e) => setSuggestLimit(Number(e.target.value))}
          className="rounded border px-3 py-2 text-sm"
        >
          {[60, 80, 100, 120, 140, 160, 180, 200].map((n) => (
            <option key={n} value={n}>{n}개</option>
          ))}
        </select>
        <button
          onClick={handleGenerate}
          disabled={isGenerating || isExtendedGenerating}
          className="px-6 py-3 bg-black text-white rounded font-semibold disabled:opacity-50"
        >
          {isGenerating ? '분석 중...' : '토픽 제안 받기'}
        </button>
        <select
          value={suggestExtendedLimit}
          onChange={(e) => setSuggestExtendedLimit(Number(e.target.value))}
          className="rounded border px-3 py-2 text-sm"
        >
          {[60, 80, 100, 120, 140, 160, 180, 200].map((n) => (
            <option key={n} value={n}>{n}개</option>
          ))}
        </select>
        <button
          onClick={handleExtendedGenerate}
          disabled={isGenerating || isExtendedGenerating}
          className="px-6 py-3 border border-gray-300 text-gray-700 rounded font-semibold hover:bg-gray-50 disabled:opacity-50"
        >
          {isExtendedGenerating ? '실행 중...' : '토픽 확장 제안'}
        </button>
        {lastGenSummary && <p className="text-sm text-gray-500">{lastGenSummary}</p>}
        {extendedMessage && <p className="text-sm text-blue-600">{extendedMessage}</p>}
      </div>

      <div className="flex items-center justify-between mb-4 border-b">
        <div className="flex gap-2 text-sm">
          {[
            { id: 'pending', label: '미처리' },
            { id: 'published', label: '기사 생성 완료' },
            { id: 'rejected', label: '거절됨' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSubTab(tab.id as SubTab)}
              className={`px-3 py-2 font-medium border-b-2 transition-colors ${
                subTab === tab.id
                  ? 'border-black text-black'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {subTab === 'pending' && suggestions.length > 0 && (
          <button
            onClick={handleDeleteAllPending}
            disabled={isGenerating || isExtendedGenerating}
            className="px-3 py-1 mb-1 text-sm text-red-600 border border-red-300 rounded hover:bg-red-50 disabled:opacity-50"
          >
            pending 전체 삭제
          </button>
        )}
      </div>

      {error && <p className="text-red-500 mb-4">{error}</p>}

      {isLoading && <p className="text-gray-500">불러오는 중...</p>}

      {!isLoading && suggestions.length === 0 && !error && (
        <p className="text-gray-500">{emptyMessage}</p>
      )}

      {suggestions.length > 0 && (
        <div className="space-y-4">
          {suggestions.map((s) => {
            const result = results[s.id]
            const isProcessing = processingIds.has(s.id)
            return (
              <div key={s.id} className="border rounded p-4">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-lg">{s.topic}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      {typeof s.cohesionScore === 'number' && (
                        <span className="font-medium text-gray-700">응집도 {s.cohesionScore}</span>
                      )}
                      {s.commonEntities && s.commonEntities.length > 0 && (
                        <span>공통 근거: {s.commonEntities.join(', ')}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {s.keywords.map((k) => (
                        <span key={k} className="px-2 py-0.5 text-xs bg-gray-100 rounded">
                          {k}
                        </span>
                      ))}
                    </div>
                  </div>

                  {subTab === 'pending' && (
                    <div className="flex gap-2 whitespace-nowrap">
                      <button
                        onClick={() => handleApprove(s)}
                        disabled={isProcessing}
                        className="px-3 py-2 bg-black text-white text-sm rounded font-semibold disabled:opacity-50"
                      >
                        {isProcessing ? '처리 중...' : '승인 & 기사 생성'}
                      </button>
                      <button
                        onClick={() => handleReject(s)}
                        disabled={isProcessing}
                        className="px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded font-semibold hover:bg-gray-50 disabled:opacity-50"
                      >
                        거절
                      </button>
                    </div>
                  )}

                  {subTab === 'published' && s.clusterId && (
                    <span className="px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded whitespace-nowrap">
                      기사 초안 생성됨
                    </span>
                  )}
                </div>

                {s.reason && <p className="mb-3 text-sm text-gray-600">{s.reason}</p>}

                <details className="mt-2">
                  <summary className="text-sm text-gray-500 cursor-pointer">
                    매칭된 기사 {s.articles.length}개
                  </summary>
                  <ul className="mt-2 text-sm text-gray-600 space-y-1">
                    {s.articles.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-2">
                        <span className="truncate">
                          ・{' '}
                          <a
                            href={a.url}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline"
                          >
                            {a.title}
                          </a>
                        </span>
                        <button
                          type="button"
                          onClick={() => handleIgnoreArticle(s.id, a.id)}
                          className="shrink-0 text-xs text-gray-400 hover:text-red-500"
                        >
                          ignore
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>

                {result && (
                  <p
                    className={`mt-3 text-sm ${
                      result.state === 'success'
                        ? 'text-green-600'
                        : result.state === 'error'
                        ? 'text-red-500'
                        : 'text-gray-500'
                    }`}
                  >
                    {result.message}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

type ArticleReviewSubTab = 'draft' | 'published'

function ArticlesReviewTab() {
  const [subTab, setSubTab] = useState<ArticleReviewSubTab>('draft')
  const [articles, setArticles] = useState<AdminArticle[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [processing, setProcessing] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [editGenre, setEditGenre] = useState('')
  const [replacingId, setReplacingId] = useState<string | null>(null)
  const [replacementImageDataUrl, setReplacementImageDataUrl] = useState('')
  const [replacementUseCrop, setReplacementUseCrop] = useState(false)
  const [replacementCrop, setReplacementCrop] = useState<PercentCrop | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [publishedSearch, setPublishedSearch] = useState('')
  const [preview, setPreview] = useState<ArticlePreviewPayload | null>(null)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [editorArticleId, setEditorArticleId] = useState<string | null | undefined>(undefined)

  const load = useCallback(async (tab: ArticleReviewSubTab, search: string = '') => {
    setIsLoading(true)
    setError('')
    setMessage('')

    try {
      const trimmed = search.trim()
      const params = new URLSearchParams()
      params.set('published', tab === 'published' ? 'true' : 'false')
      if (tab === 'published') {
        if (trimmed) {
          params.set('search', trimmed)
          params.set('limit', '20')
        } else {
          params.set('limit', '10')
        }
      } else {
        params.set('limit', '50')
      }

      const res = await fetch(`/api/articles?${params.toString()}`)
      const data = await res.json()

      if (data.error) {
        setError(data.error)
        setArticles([])
      } else {
        setArticles((data.articles ?? []) as AdminArticle[])
      }
    } catch {
      setError('기사 목록을 불러오지 못했습니다.')
      setArticles([])
    }

    setIsLoading(false)
  }, [])

  useEffect(() => {
    if (subTab !== 'published') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      load(subTab, '')
      return
    }
    const timer = setTimeout(() => {
      load('published', publishedSearch)
    }, 250)
    return () => clearTimeout(timer)
  }, [subTab, publishedSearch, load])

  const handlePublish = async (article: AdminArticle) => {
    setProcessing(article.id)
    setError('')
    setMessage('')

    try {
      const res = await fetch(`/api/articles/${article.id}/publish`, {
        method: 'PATCH',
      })
      const data = await res.json()

      if (data.error) {
        setError(data.error)
      } else {
        setMessage(`게시 완료: ${data.article?.title ?? article.title}`)
        await load(subTab, subTab === 'published' ? publishedSearch : '')
      }
    } catch {
      setError('게시 중 오류가 발생했습니다.')
    }

    setProcessing(null)
  }

  const handleUnpublish = async (article: AdminArticle) => {
    const ok = window.confirm('이 기사를 게시 취소하시겠습니까?')
    if (!ok) return

    setProcessing(article.id)
    setError('')
    setMessage('')

    try {
      const res = await fetch(`/api/articles/${article.id}/unpublish`, {
        method: 'PATCH',
      })
      const data = await res.json()

      if (data.error) {
        setError(data.error)
      } else {
        setMessage(`게시 취소 완료: ${data.article?.title ?? article.title}`)
        setArticles((prev) => prev.filter((a) => a.id !== article.id))
        setPublishedSearch('')
        setSubTab('draft')
      }
    } catch {
      setError('게시 취소 중 오류가 발생했습니다.')
    }

    setProcessing(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditTitle('')
    setEditContent('')
    setEditCategory('')
    setEditGenre('')
  }

  const startReplaceImage = (article: AdminArticle) => {
    setReplacingId(article.id)
    setReplacementImageDataUrl('')
    setReplacementUseCrop(false)
    setReplacementCrop(null)
    setError('')
    setMessage('')
  }

  const cancelReplaceImage = () => {
    setReplacingId(null)
    setReplacementImageDataUrl('')
    setReplacementUseCrop(false)
    setReplacementCrop(null)
  }

  const insertImageMarkdown = () => {
    const url = window.prompt('삽입할 이미지 URL을 입력하세요.')
    if (!url?.trim()) return

    const alt = window.prompt('이미지 설명(alt)을 입력하세요.')?.trim() || '이미지'
    const imageMarkdown = `\n\n![${alt}](${url.trim()})\n\n`
    setEditContent((content) => `${content}${imageMarkdown}`)
  }

  const handleSaveEdit = async (article: AdminArticle) => {
    setProcessing(article.id)
    setError('')
    setMessage('')

    try {
      const res = await fetch(`/api/articles/${article.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle,
          content: editContent,
          category: editCategory,
          genre: editGenre,
        }),
      })
      const data = await res.json()

      if (data.error) {
        setError(data.error)
      } else {
        setMessage(`수정 완료: ${data.article?.title ?? editTitle}`)
        cancelEdit()
        await load(subTab, subTab === 'published' ? publishedSearch : '')
      }
    } catch {
      setError('수정 중 오류가 발생했습니다.')
    }

    setProcessing(null)
  }

  const handleDelete = async (article: AdminArticle) => {
    const ok = window.confirm(`이 기사 초안을 삭제할까요?\n\n${article.title}`)
    if (!ok) return

    setProcessing(article.id)
    setError('')
    setMessage('')

    try {
      const res = await fetch(`/api/articles/${article.id}`, {
        method: 'DELETE',
      })
      const data = await res.json()

      if (data.error) {
        setError(data.error)
      } else {
        setMessage(`삭제 완료: ${data.article?.title ?? article.title}`)
        await load(subTab, subTab === 'published' ? publishedSearch : '')
      }
    } catch {
      setError('삭제 중 오류가 발생했습니다.')
    }

    setProcessing(null)
  }

  const handleReview = async (article: AdminArticle) => {
    setIsPreviewLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/articles/${article.id}/preview`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) {
        setError(data.error ?? '미리보기를 불러오지 못했습니다.')
        return
      }
      setPreview(data as ArticlePreviewPayload)
    } catch {
      setError('미리보기를 불러오지 못했습니다.')
    } finally {
      setIsPreviewLoading(false)
    }
  }

  const handleSaveReplacementImage = async (article: AdminArticle) => {
    if (!replacementImageDataUrl) {
      setError('교체할 이미지를 선택하세요.')
      return
    }

    setProcessing(article.id)
    setError('')
    setMessage('')

    try {
      const imageBase64 = replacementUseCrop && replacementCrop
        ? await getCroppedDataUrl(replacementImageDataUrl, replacementCrop)
        : replacementImageDataUrl
      const res = await fetch(`/api/articles/${article.id}/image`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          mimeType: replacementUseCrop && replacementCrop ? 'image/jpeg' : undefined,
        }),
      })
      const data = await res.json()

      if (data.error) {
        setError(data.error)
      } else {
        setMessage(`이미지 교체 완료: ${data.article?.title ?? article.title}`)
        cancelReplaceImage()
        await load(subTab, subTab === 'published' ? publishedSearch : '')
      }
    } catch (err) {
      setError(String(err))
    }

    setProcessing(null)
  }

  const emptyMessage =
    subTab === 'draft'
      ? '게시 대기 중인 기사 초안이 없습니다.'
      : '게시된 기사가 아직 없습니다.'

  return (
    <div>
      {editorArticleId !== undefined && (
        <EditorialArticleEditor
          articleId={editorArticleId}
          onClose={() => setEditorArticleId(undefined)}
          onSaved={() => load(subTab, subTab === 'published' ? publishedSearch : '')}
        />
      )}
      {preview && (
        <ArticlePreviewModal
          preview={preview}
          onClose={() => setPreview(null)}
        />
      )}
      <p className="text-gray-600 mb-6">
        생성된 기사 초안과 게시된 기사를 검토하고 수정합니다. 게시된 기사를 저장하면 Cloudflare 재빌드가 자동으로 요청됩니다.
      </p>

      <button
        type="button"
        onClick={() => setEditorArticleId(null)}
        className="mb-6 rounded bg-black px-4 py-2 text-sm font-semibold text-white"
      >
        새 기사
      </button>

      <div className="flex gap-2 mb-4 border-b text-sm">
        {[
          { id: 'draft', label: '게시 대기' },
          { id: 'published', label: '게시됨' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSubTab(tab.id as ArticleReviewSubTab)}
            className={`px-3 py-2 font-medium border-b-2 transition-colors ${
              subTab === tab.id
                ? 'border-black text-black'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {subTab === 'published' && (
        <div className="mb-4 flex items-center gap-2">
          <input
            type="search"
            value={publishedSearch}
            onChange={(e) => setPublishedSearch(e.target.value)}
            placeholder="제목 또는 slug 검색"
            className="w-full max-w-md rounded border px-3 py-2 text-sm"
          />
          {publishedSearch && (
            <button
              type="button"
              onClick={() => setPublishedSearch('')}
              className="px-3 py-2 text-sm text-gray-500 hover:text-black"
            >
              지우기
            </button>
          )}
        </div>
      )}

      {message && <p className="text-green-600 mb-4">{message}</p>}
      {error && <p className="text-red-500 mb-4">{error}</p>}
      {isLoading && <p className="text-gray-500">불러오는 중...</p>}

      {!isLoading && articles.length === 0 && !error && (
        <p className="text-gray-500">{emptyMessage}</p>
      )}

      {!isLoading && articles.length > 0 && (
        <div className="space-y-4">
          {articles.map((article) => {
            const isEditing = editingId === article.id
            const isReplacing = replacingId === article.id
            return (
              <article key={article.id} className="border rounded p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <span>{article.published ? '게시일' : '생성일'} {formatDate(article.published_at ?? article.created_at)}</span>
                      {article.updated_at && <span>수정일 {formatDate(article.updated_at)}</span>}
                      {article.cluster_id && <span>cluster {article.cluster_id}</span>}
                    </div>

                    {isReplacing ? (
                      <div className="space-y-4">
                        <div>
                          <p className="mb-2 text-sm font-semibold text-gray-800">새 이미지 업로드</p>
                          <input
                            type="file"
                            accept="image/jpeg,image/png"
                            onChange={async (e) => {
                              const file = e.target.files?.[0]
                              if (!file) {
                                setReplacementImageDataUrl('')
                                setReplacementUseCrop(false)
                                setReplacementCrop(null)
                                return
                              }
                              try {
                                setReplacementImageDataUrl(await fileToDataUrl(file))
                                setReplacementUseCrop(false)
                                setReplacementCrop(null)
                              } catch (err) {
                                setError(String(err))
                              }
                            }}
                            className="block w-full rounded border p-3 text-sm file:mr-4 file:rounded file:border-0 file:bg-black file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
                          />
                        </div>
                        {replacementImageDataUrl ? (
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <p className="text-sm text-gray-500">
                                크롭을 사용하지 않으면 업로드한 원본 이미지가 그대로 저장됩니다.
                              </p>
                              <label className="flex items-center gap-2 text-sm text-gray-700">
                                <input
                                  type="checkbox"
                                  checked={replacementUseCrop}
                                  onChange={(e) => {
                                    setReplacementUseCrop(e.target.checked)
                                    if (!e.target.checked) setReplacementCrop(null)
                                  }}
                                />
                                크롭 사용
                              </label>
                            </div>
                            {replacementUseCrop ? (
                              <ImageCropper
                                imageUrl={replacementImageDataUrl}
                                onCropChange={setReplacementCrop}
                              />
                            ) : (
                              <div className="max-h-[420px] overflow-hidden rounded border bg-gray-100">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={replacementImageDataUrl}
                                  alt=""
                                  className="block max-h-[420px] w-full object-contain"
                                />
                              </div>
                            )}
                          </div>
                        ) : article.image_url ? (
                          <div className="max-w-xs">
                            <p className="mb-2 text-sm font-semibold text-gray-800">현재 이미지</p>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={article.image_url}
                              alt=""
                              className="w-full rounded border bg-gray-100 object-cover"
                            />
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500">현재 등록된 이미지가 없습니다.</p>
                        )}
                      </div>
                    ) : isEditing ? (
                      <div className="space-y-3">
                        <input
                          className="w-full rounded border p-3 text-lg font-semibold"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                        />
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <input
                            className="w-full rounded border p-3 text-sm"
                            placeholder="카테고리 (페스티벌, 릴리즈, 뉴스)"
                            value={editCategory}
                            onChange={(e) => setEditCategory(e.target.value)}
                          />
                          <input
                            className="w-full rounded border p-3 text-sm"
                            placeholder="장르 (예: techno, house, trance)"
                            value={editGenre}
                            onChange={(e) => setEditGenre(e.target.value)}
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={insertImageMarkdown}
                            className="px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded font-semibold hover:bg-gray-50"
                          >
                            이미지 삽입
                          </button>
                          <span className="text-xs text-gray-500">
                            본문 끝에 Markdown 이미지 문법으로 추가됩니다.
                          </span>
                        </div>
                        <textarea
                          className="h-72 w-full rounded border p-3 text-sm leading-6"
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                        />
                      </div>
                    ) : (
                      <>
                        <div className="mb-2 flex flex-wrap gap-1.5 text-xs">
                          {article.category && (
                            <span className="rounded bg-gray-900 px-2 py-0.5 font-medium text-white">
                              {article.category}
                            </span>
                          )}
                          {article.genre && (
                            <span className="rounded border border-gray-300 px-2 py-0.5 text-gray-600">
                              {article.genre}
                            </span>
                          )}
                        </div>
                        <h3 className="text-lg font-semibold leading-snug">{article.title}</h3>
                        <p className="mt-2 text-sm text-gray-600 line-clamp-3">{article.content}</p>
                      </>
                    )}
                  </div>

                  <div className="flex shrink-0 gap-2">
                    {isReplacing ? (
                      <>
                        <button
                          onClick={() => handleSaveReplacementImage(article)}
                          disabled={processing !== null || !replacementImageDataUrl}
                          className="px-3 py-2 bg-black text-white text-sm rounded font-semibold disabled:opacity-50 whitespace-nowrap"
                        >
                          {processing === article.id ? '저장 중...' : '이미지 저장'}
                        </button>
                        <button
                          onClick={cancelReplaceImage}
                          disabled={processing !== null}
                          className="px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded font-semibold hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
                        >
                          취소
                        </button>
                      </>
                    ) : isEditing ? (
                      <>
                        <button
                          onClick={() => handleSaveEdit(article)}
                          disabled={processing !== null}
                          className="px-3 py-2 bg-black text-white text-sm rounded font-semibold disabled:opacity-50 whitespace-nowrap"
                        >
                          {processing === article.id ? '저장 중...' : '저장'}
                        </button>
                        <button
                          onClick={cancelEdit}
                          disabled={processing !== null}
                          className="px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded font-semibold hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
                        >
                          취소
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleReview(article)}
                          disabled={isPreviewLoading}
                          className="px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded font-semibold hover:bg-gray-50 whitespace-nowrap"
                        >
                          {isPreviewLoading ? '불러오는 중...' : '검토'}
                        </button>
                        <button
                          onClick={() => setEditorArticleId(article.id)}
                          disabled={processing !== null || editingId !== null || replacingId !== null}
                          className="px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded font-semibold hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
                        >
                          에디터 열기
                        </button>
                        <button
                          onClick={() => startReplaceImage(article)}
                          disabled={processing !== null || editingId !== null || replacingId !== null}
                          className="px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded font-semibold hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
                        >
                          이미지 교체
                        </button>
                        {subTab === 'published' && (
                          <button
                            onClick={() => handleUnpublish(article)}
                            disabled={processing !== null || editingId !== null || replacingId !== null}
                            className="px-3 py-2 border border-red-300 text-red-600 text-sm rounded font-semibold hover:bg-red-50 disabled:opacity-50 whitespace-nowrap"
                          >
                            {processing === article.id ? '처리 중...' : '게시 취소'}
                          </button>
                        )}
                        {subTab === 'draft' && (
                          <>
                            <button
                              onClick={() => handlePublish(article)}
                              disabled={processing !== null || editingId !== null || replacingId !== null}
                              className="px-3 py-2 bg-black text-white text-sm rounded font-semibold disabled:opacity-50 whitespace-nowrap"
                            >
                              {processing === article.id ? '게시 중...' : '게시'}
                            </button>
                            <button
                              onClick={() => handleDelete(article)}
                              disabled={processing !== null || editingId !== null || replacingId !== null}
                              className="px-3 py-2 border border-red-300 text-red-600 text-sm rounded font-semibold hover:bg-red-50 disabled:opacity-50 whitespace-nowrap"
                            >
                              {processing === article.id ? '처리 중...' : '삭제'}
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ArticlePreviewModal({
  preview,
  onClose,
}: {
  preview: ArticlePreviewPayload
  onClose: () => void
}) {
  const { article, leadingImageUrl } = preview

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/60 p-4 md:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={`${article.title} 미리보기`}
    >
      <div className="mx-auto min-h-full max-w-[1280px] bg-white px-4 py-8 shadow-2xl md:px-8 md:py-12">
        <div className="mb-8 flex items-center justify-between border-b border-gray-200 pb-4">
          <span className="text-sm font-semibold text-gray-600">관리자 초안 미리보기</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-300 px-4 py-2 text-sm font-semibold hover:bg-gray-50"
          >
            닫기
          </button>
        </div>

        <article className="max-w-[720px]">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <time>
              {article.published_at ? '발행' : '생성'}{' '}
              {formatDate(article.published_at ?? article.created_at)}
            </time>
            {!article.published && (
              <span className="bg-gray-200 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">
                초안
              </span>
            )}
          </div>

          {(article.category || article.genre) && (
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              {article.category && (
                <span className="inline-block bg-gray-900 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white">
                  {article.category}
                </span>
              )}
              {article.genre && (
                <span className="inline-block border border-gray-300 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-gray-600">
                  {article.genre}
                </span>
              )}
            </div>
          )}

          <h1 className="mb-4 text-2xl font-black leading-tight tracking-tight sm:text-3xl md:text-4xl">
            {article.title}
          </h1>
          <div className="mb-8 border-b border-gray-200 pb-4 text-sm">
            <span className="text-gray-500">기사 · 편집</span>
            <span className="ml-2 font-medium text-gray-800">FEEL THE DROP</span>
          </div>
          <ArticleRenderer
            content={article.content}
            contentBlocks={article.content_blocks}
            leadingImageUrl={leadingImageUrl}
          />
        </article>
      </div>
    </div>
  )
}

function GenerateTab() {
  const [clusterId, setClusterId] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<GenerateResult | null>(null)

  const handleGenerate = async () => {
    if (!clusterId) return
    setIsLoading(true)
    setResult(null)
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clusterIds: [clusterId] }),
      })
      const data = await res.json()
      if (!res.ok || data.error || !data.jobId) {
        setResult({ success: false, error: data.error ?? '잡 등록 실패' })
        setIsLoading(false)
        return
      }

      const poll = await pollJobStatus(data.jobId)
      if (poll.status === 'done') {
        const first = Array.isArray(poll.result) ? poll.result[0] : poll.result
        setResult((first ?? { success: false, error: '결과 없음' }) as GenerateResult)
      } else {
        setResult({ success: false, error: poll.error_message ?? '기사 생성 실패' })
      }
    } catch {
      setResult({ success: false, error: '오류가 발생했습니다.' })
    }
    setIsLoading(false)
  }

  return (
    <div>
      <p className="text-gray-600 mb-6">클러스터 ID를 입력하면 한국어 종합 기사를 생성합니다.</p>
      <input
        className="w-full p-3 border rounded mb-4"
        placeholder="클러스터 ID (UUID)"
        value={clusterId}
        onChange={(e) => setClusterId(e.target.value)}
      />
      <button
        onClick={handleGenerate}
        disabled={isLoading}
        className="px-6 py-3 bg-black text-white rounded font-semibold disabled:opacity-50"
      >
        {isLoading ? '생성 중...' : '기사 생성'}
      </button>
      {result && (
        <div className={`mt-6 p-4 rounded border ${result.success ? 'border-green-400' : 'border-red-400'}`}>
          {result.success ? (
            <>
              <p className="font-bold text-lg">{result.article?.title}</p>
              <p className="text-gray-600 mt-2">{result.article?.content}</p>
            </>
          ) : (
            <p className="text-red-500">{result.error}</p>
          )}
        </div>
      )}
    </div>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

type InterviewCandidate = {
  id: string
  title: string | null
  url: string
  published_at: string | null
}

function InterviewDiscoveryTab() {
  const [candidates, setCandidates] = useState<InterviewCandidate[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [processing, setProcessing] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [results, setResults] = useState<Record<string, { state: 'pending' | 'success' | 'error'; message: string }>>({})

  const load = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      const res = await fetch('/api/interview/discover', { method: 'POST' })
      const data = await res.json()
      if (!data.success) {
        throw new Error(data.error ?? '인터뷰 후보 발굴에 실패했습니다.')
      }
      setCandidates((data.candidates ?? []) as InterviewCandidate[])
    } catch (err) {
      setError(String(err))
    }
    setIsLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleTranslate = async (article: InterviewCandidate) => {
    setProcessing(article.id)
    setResults((r) => ({ ...r, [article.id]: { state: 'pending', message: '번역 중...' } }))
    try {
      const res = await fetch('/api/interview/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_article_id: article.id }),
      })
      const data = await res.json()
      if (data.success) {
        setResults((r) => ({ ...r, [article.id]: { state: 'success', message: '번역 완료' } }))
      } else {
        setResults((r) => ({ ...r, [article.id]: { state: 'error', message: data.error } }))
      }
    } catch (err) {
      setResults((r) => ({ ...r, [article.id]: { state: 'error', message: String(err) } }))
    }
    setProcessing(null)
  }

  const handleReject = async (article: InterviewCandidate) => {
    setProcessing(article.id)
    setResults((r) => ({ ...r, [article.id]: { state: 'pending', message: '기각 중...' } }))
    try {
      const res = await fetch(`/api/raw-articles/${article.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestion_state: 'rejected' }),
      })
      const data = await res.json()
      if (data.success) {
        setResults((r) => ({ ...r, [article.id]: { state: 'success', message: '기각됨' } }))
      } else {
        setResults((r) => ({ ...r, [article.id]: { state: 'error', message: data.error } }))
      }
    } catch (err) {
      setResults((r) => ({ ...r, [article.id]: { state: 'error', message: String(err) } }))
    }
    setProcessing(null)
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <p className="text-gray-600">인터뷰로 추정되는 원문을 찾아 번역합니다.</p>
        <button onClick={load} disabled={isLoading} className="px-3 py-2 text-sm border rounded hover:bg-gray-50">
          새로고침
        </button>
      </div>

      {error && <p className="text-red-500 mb-4">{error}</p>}
      {isLoading && <p className="text-gray-500">불러오는 중...</p>}

      {!isLoading && candidates.length === 0 && !error && (
        <p className="text-gray-500">발견된 인터뷰 후보가 없습니다.</p>
      )}

      {candidates.length > 0 && (
        <div className="space-y-4">
          {candidates.map(c => {
            const result = results[c.id]
            const isProcessing = processing === c.id
            return (
              <div key={c.id} className="border rounded p-4 flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold">{c.title || '제목 없음'}</h3>
                  <a href={c.url} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline block truncate mt-1">{c.url}</a>
                  <p className="text-xs text-gray-500 mt-1">발행일: {c.published_at ? formatDate(c.published_at) : '불명'}</p>
                  {result && (
                    <p className={`mt-2 text-sm ${result.state === 'success' ? 'text-green-600' : result.state === 'error' ? 'text-red-500' : 'text-gray-500'}`}>
                      {result.message}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleTranslate(c)}
                    disabled={processing !== null || result?.state === 'success'}
                    className="px-4 py-2 bg-black text-white text-sm rounded font-semibold disabled:opacity-50 whitespace-nowrap"
                  >
                    {isProcessing && result?.message !== '기각 중...' ? '처리 중...' : result?.message === '번역 완료' ? '완료' : '번역 실행'}
                  </button>
                  <button
                    onClick={() => handleReject(c)}
                    disabled={processing !== null || result?.state === 'success'}
                    className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded font-semibold hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
                  >
                    {result?.message === '기각됨' ? '기각됨' : '기각'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TextSourceTab() {
  const [rawText, setRawText] = useState('')
  const [sourceMemo, setSourceMemo] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceDate, setSourceDate] = useState('')
  const [mode, setMode] = useState<'article' | 'translate'>('article')
  const [isSaving, setIsSaving] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [savedSourceId, setSavedSourceId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!rawText.trim() || !sourceMemo.trim()) {
      setError('텍스트 원문과 소스 메모를 모두 입력하세요.')
      return
    }

    setIsSaving(true)
    setError('')
    setMessage('')
    setSavedSourceId(null)

    try {
      const res = await fetch('/api/text-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raw_text: rawText,
          source_memo: sourceMemo,
          source_url: sourceUrl,
          source_date: sourceDate,
          mode,
        }),
      })
      const data = await res.json()

      if (data.error) {
        setError(data.error)
      } else {
        setSavedSourceId(data.textSource.id)
        setMessage('텍스트 소스가 저장되었습니다. 기사 초안을 생성할 수 있습니다.')
      }
    } catch (err) {
      setError(String(err))
    }

    setIsSaving(false)
  }

  const handleGenerate = async () => {
    if (!savedSourceId) return

    setIsGenerating(true)
    setError('')
    setMessage('')

    try {
      const res = await fetch(`/api/text-sources/${savedSourceId}/generate`, {
        method: 'POST',
      })
      const data = await res.json()

      if (!res.ok || data.error || !data.jobId) {
        setError(data.error ?? '잡 등록 실패')
        setIsGenerating(false)
        return
      }

      setMessage('기사 생성 중...')
      const poll = await pollJobStatus(data.jobId)
      if (poll.status === 'done') {
        setMessage(`기사 생성 완료: ${poll.result?.article?.title ?? ''}`)
        setSavedSourceId(null)
        setRawText('')
        setSourceMemo('')
        setSourceUrl('')
        setSourceDate('')
      } else {
        setError(poll.error_message ?? '기사 생성 실패')
        setMessage('')
      }
    } catch (err) {
      setError(String(err))
    }

    setIsGenerating(false)
  }

  return (
    <div>
      <p className="text-gray-600 mb-6">
        유튜브 트랜스크립트나 인터뷰 원문 등 긴 텍스트를 입력하면 LLM이 분석하여 한국어 EDM 기사 초안을 생성합니다.
      </p>

      <div className="space-y-5 rounded border p-5">
        <div>
          <label className="mb-2 block text-sm font-semibold text-gray-800">
            생성 모드
          </label>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="text-source-mode"
                value="article"
                checked={mode === 'article'}
                onChange={() => setMode('article')}
              />
              <span>단신 기사 생성</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="text-source-mode"
                value="translate"
                checked={mode === 'translate'}
                onChange={() => setMode('translate')}
              />
              <span>충실 번역</span>
            </label>
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-semibold text-gray-800">
            텍스트 원문
            <span className="ml-1 text-red-500">*</span>
          </label>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            className="h-48 w-full rounded border p-3 text-sm font-mono"
            placeholder="유튜브 트랜스크립트, 인터뷰 원문 등"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-semibold text-gray-800">
            맥락 메모
            <span className="ml-1 text-red-500">*</span>
          </label>
          <textarea
            value={sourceMemo}
            onChange={(e) => setSourceMemo(e.target.value)}
            className="h-20 w-full rounded border p-3 text-sm"
            placeholder="예: Suzanne Ciani 인터뷰 - YouTube Live Art Exchange, 2026.05"
          />
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-semibold text-gray-800">
              출처 URL
              <span className="ml-1 font-normal text-gray-400">(선택)</span>
            </label>
            <input
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              className="w-full rounded border p-3 text-sm"
              placeholder="https://youtube.com/..."
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-gray-800">
              날짜
              <span className="ml-1 font-normal text-gray-400">(선택)</span>
            </label>
            <input
              type="date"
              value={sourceDate}
              onChange={(e) => setSourceDate(e.target.value)}
              className="w-full rounded border p-3 text-sm"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || isGenerating || !rawText.trim() || !sourceMemo.trim()}
            className="px-6 py-3 bg-black text-white rounded font-semibold disabled:opacity-50"
          >
            {isSaving ? '저장 중...' : '저장'}
          </button>
          
          {savedSourceId && (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating || isSaving}
              className="px-6 py-3 border border-gray-300 text-gray-700 rounded font-semibold hover:bg-gray-50 disabled:opacity-50"
            >
              {isGenerating ? '처리 중...' : '기사 초안 생성'}
            </button>
          )}
        </div>

        {message && <p className="text-green-600">{message}</p>}
        {error && <p className="text-red-500">{error}</p>}
      </div>
    </div>
  )
}

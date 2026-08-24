'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArticleRenderer } from '@/components/ArticleRenderer'
import {
  type ArticleBlockDocument,
  type ArticleContentBlock,
  importMarkdownDocument,
  inlineToMarkdown,
  parseInlineMarkdown,
  projectBlocksToContent,
} from '@/lib/article-blocks'
import type { ArticleCoverImageMode } from '@/lib/article-cover'
import { EditorialUploadSession } from '@/lib/editorial-upload-session'

type EditorialArticleEditorProps = {
  articleId: string | null
  onClose: () => void
  onSaved: () => void
}

async function deleteEditorialUpload(path: string): Promise<boolean> {
  const response = await fetch('/api/admin/media', {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storagePath: path }),
  }).catch(() => null)
  return Boolean(response?.ok)
}

const EMPTY_DOCUMENT: ArticleBlockDocument = {
  version: 1,
  blocks: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }],
}

function newBlock(type: ArticleContentBlock['type']): ArticleContentBlock {
  if (type === 'heading') return { type, level: 2, content: [{ type: 'text', text: '' }] }
  if (type === 'list') return { type, ordered: false, items: [[{ type: 'text', text: '' }]] }
  if (type === 'image') return { type, src: 'https://', alt: '' }
  return { type, content: [{ type: 'text', text: '' }] }
}

export function EditorialArticleEditor({ articleId, onClose, onSaved }: EditorialArticleEditorProps) {
  const [title, setTitle] = useState('제목 없는 기사')
  const [category, setCategory] = useState('')
  const [genre, setGenre] = useState('')
  const [slug, setSlug] = useState('')
  const [coverImageMode, setCoverImageMode] = useState<Exclude<ArticleCoverImageMode, null>>('none')
  const [showCoverInArticle, setShowCoverInArticle] = useState(true)
  const [imageUrl, setImageUrl] = useState('')
  const [coverImagePath, setCoverImagePath] = useState<string | null>(null)
  const [autoLeadingImageUrl, setAutoLeadingImageUrl] = useState<string | null>(null)
  const [isPublished, setIsPublished] = useState(false)
  const [document, setDocument] = useState<ArticleBlockDocument>(EMPTY_DOCUMENT)
  const [markdown, setMarkdown] = useState('')
  const [loading, setLoading] = useState(Boolean(articleId))
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const uploadSession = useRef(new EditorialUploadSession())

  useEffect(() => {
    if (!articleId) return
    let cancelled = false
    fetch(`/api/admin/articles/${articleId}`)
      .then(async (response) => ({ response, data: await response.json().catch(() => ({})) }))
      .then(({ response, data }) => {
        if (cancelled) return
        if (!response.ok || data.error) throw new Error(data.error ?? '기사를 불러오지 못했습니다.')
        setTitle(data.article.title)
        setCategory(data.article.category ?? '')
        setGenre(data.article.genre ?? '')
        setSlug(data.article.slug ?? '')
        setCoverImageMode(data.article.cover_image_mode ?? 'auto')
        setShowCoverInArticle(data.article.show_cover_in_article !== false)
        setImageUrl(data.article.image_url ?? '')
        setCoverImagePath(data.article.cover_image_path ?? null)
        setAutoLeadingImageUrl(data.leadingImageUrl ?? null)
        setIsPublished(Boolean(data.article.published))
        setDocument(data.contentBlocks)
      })
      .catch((reason) => { if (!cancelled) setError(String(reason)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [articleId])

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  useEffect(() => {
    void uploadSession.current.reconcile(document, coverImagePath, deleteEditorialUpload)
  }, [document, coverImagePath])

  const projectedContent = useMemo(() => projectBlocksToContent(document), [document])
  const changeDocument = (next: ArticleBlockDocument) => {
    setDocument(next)
    setDirty(true)
  }
  const changeBlock = (index: number, block: ArticleContentBlock) => {
    changeDocument({ ...document, blocks: document.blocks.map((value, position) => position === index ? block : value) })
  }
  const moveBlock = (index: number, offset: number) => {
    const target = index + offset
    if (target < 0 || target >= document.blocks.length) return
    const blocks = [...document.blocks]
    ;[blocks[index], blocks[target]] = [blocks[target], blocks[index]]
    changeDocument({ ...document, blocks })
  }
  const insertImageBlock = (index: number) => {
    const blocks = [...document.blocks]
    blocks.splice(index, 0, newBlock('image'))
    changeDocument({ ...document, blocks })
  }
  const uploadImage = async (file: File, onUploaded: (upload: { publicUrl: string; storagePath: string }) => void) => {
    setUploading(true)
    setError('')
    try {
      const form = new FormData()
      form.set('file', file)
      const response = await fetch('/api/admin/media', { method: 'POST', body: form })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.error) throw new Error(data.error ?? '이미지를 업로드하지 못했습니다.')
      uploadSession.current.register(data.storagePath)
      onUploaded(data)
      setDirty(true)
    } catch (reason) {
      setError(String(reason))
    } finally {
      setUploading(false)
    }
  }
  const requestClose = async () => {
    if (dirty && !window.confirm('저장하지 않은 변경이 있습니다. 닫을까요?')) return
    await uploadSession.current.abandon(deleteEditorialUpload)
    onClose()
  }
  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const response = await fetch(articleId ? `/api/admin/articles/${articleId}` : '/api/admin/articles', {
        method: articleId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          category: category || null,
          genre: genre || null,
          slug: slug || null,
          coverImageMode,
          showCoverInArticle,
          imageUrl: imageUrl || null,
          coverImagePath,
          contentBlocks: document,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.error) throw new Error(data.error ?? '저장하지 못했습니다.')
      await uploadSession.current.finishSave(document, coverImagePath, deleteEditorialUpload)
      setDirty(false)
      onSaved()
      onClose()
    } catch (reason) {
      setError(String(reason))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="fixed inset-0 z-50 bg-white p-8">에디터를 불러오는 중...</div>

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-gray-100 p-4 md:p-8">
      <div className="mx-auto max-w-5xl rounded bg-white p-5 shadow-xl md:p-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
          <h2 className="text-xl font-bold">Editorial Editor</h2>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowPreview(true)} className="rounded border px-4 py-2 text-sm font-semibold">Preview</button>
            <button type="button" onClick={save} disabled={saving} className="rounded bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? '저장 중...' : '저장'}</button>
            <button type="button" onClick={() => void requestClose()} className="rounded border px-4 py-2 text-sm font-semibold">닫기</button>
          </div>
        </div>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <div className="mb-6 space-y-3">
          <input value={title} onChange={(event) => { setTitle(event.target.value); setDirty(true) }} className="w-full rounded border p-3 text-xl font-bold" aria-label="기사 제목" />
          <div className="grid gap-3 sm:grid-cols-2">
            <input value={category} onChange={(event) => { setCategory(event.target.value); setDirty(true) }} placeholder="category" className="rounded border p-3" />
            <input value={genre} onChange={(event) => { setGenre(event.target.value); setDirty(true) }} placeholder="genre" className="rounded border p-3" />
          </div>
          <input value={slug} disabled={isPublished} onChange={(event) => { setSlug(event.target.value); setDirty(true) }} placeholder="slug (비우면 ID route 사용)" className="w-full rounded border p-3 disabled:bg-gray-100" aria-label="기사 slug" />
          <fieldset className="rounded border p-4">
            <legend className="px-1 text-sm font-semibold">대표 이미지</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              {[['auto', '원문 이미지 자동 사용'], ['none', '대표 이미지 없음'], ['custom', '직접 업로드 / 외부 URL']].map(([value, label]) => (
                <label key={value} className="flex items-center gap-2"><input type="radio" checked={coverImageMode === value} onChange={() => { setCoverImageMode(value as Exclude<ArticleCoverImageMode, null>); setDirty(true) }} />{label}</label>
              ))}
            </div>
            {coverImageMode === 'custom' && <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
              <input value={imageUrl} onChange={(event) => { setImageUrl(event.target.value); setCoverImagePath(null); setDirty(true) }} placeholder="https://..." className="rounded border p-2" aria-label="대표 이미지 URL" />
              <label className="rounded border px-3 py-2 text-center text-sm font-semibold">{uploading ? '업로드 중...' : 'PC에서 업로드'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadImage(file, (upload) => { setImageUrl(upload.publicUrl); setCoverImagePath(upload.storagePath) }) }} /></label>
            </div>}
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showCoverInArticle}
                disabled={coverImageMode === 'none'}
                onChange={(event) => { setShowCoverInArticle(event.target.checked); setDirty(true) }}
              />
              기사 본문 상단에도 대표 이미지 표시
            </label>
          </fieldset>
        </div>

        <section className="mb-8 rounded border bg-gray-50 p-4">
          <h3 className="mb-2 font-semibold">Markdown 원고 가져오기</h3>
          <textarea value={markdown} onChange={(event) => setMarkdown(event.target.value)} className="h-36 w-full rounded border bg-white p-3 font-mono text-sm" placeholder="## 소제목\n\n원고를 붙여넣으세요." />
          <button type="button" onClick={() => { changeDocument(importMarkdownDocument(markdown)); setMarkdown('') }} className="mt-2 rounded border bg-white px-3 py-2 text-sm font-semibold">현재 blocks로 가져오기</button>
        </section>

        <div className="space-y-4">
          <button type="button" onClick={() => insertImageBlock(0)} className="rounded border px-3 py-2 text-sm">문서 맨 처음에 이미지 추가</button>
          {document.blocks.map((block, index) => (
            <div key={index} className="rounded border p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <select value={block.type} onChange={(event) => changeBlock(index, newBlock(event.target.value as ArticleContentBlock['type']))} className="rounded border px-2 py-1 text-sm">
                  <option value="paragraph">문단</option><option value="heading">제목</option><option value="list">목록</option><option value="blockquote">인용</option><option value="attribution">출처</option><option value="image">외부 이미지</option>
                </select>
                {block.type === 'heading' && <select value={block.level} onChange={(event) => changeBlock(index, { ...block, level: Number(event.target.value) as 2 | 3 })} className="rounded border px-2 py-1 text-sm"><option value={2}>H2</option><option value={3}>H3</option></select>}
                {block.type === 'list' && <select value={block.ordered ? 'ordered' : 'unordered'} onChange={(event) => changeBlock(index, { ...block, ordered: event.target.value === 'ordered' })} className="rounded border px-2 py-1 text-sm"><option value="unordered">Unordered</option><option value="ordered">Ordered</option></select>}
                <button type="button" onClick={() => moveBlock(index, -1)} disabled={index === 0} className="rounded border px-2 py-1 text-sm">위</button>
                <button type="button" onClick={() => moveBlock(index, 1)} disabled={index === document.blocks.length - 1} className="rounded border px-2 py-1 text-sm">아래</button>
                <button type="button" onClick={() => insertImageBlock(index)} className="rounded border px-2 py-1 text-sm">위에 이미지</button>
                <button type="button" onClick={() => insertImageBlock(index + 1)} className="rounded border px-2 py-1 text-sm">아래에 이미지</button>
                <button type="button" onClick={() => changeDocument({ ...document, blocks: document.blocks.filter((_, position) => position !== index) })} className="rounded border border-red-300 px-2 py-1 text-sm text-red-600">삭제</button>
              </div>
              {block.type === 'image' ? <div className="grid gap-2 sm:grid-cols-2"><input value={block.src} onChange={(event) => changeBlock(index, { ...block, src: event.target.value, storagePath: undefined })} aria-label="이미지 URL" className="rounded border p-2" /><input value={block.alt} onChange={(event) => changeBlock(index, { ...block, alt: event.target.value })} aria-label="이미지 alt" className="rounded border p-2" /><input value={block.caption ?? ''} onChange={(event) => changeBlock(index, { ...block, caption: event.target.value || undefined })} aria-label="이미지 caption" placeholder="caption" className="rounded border p-2" /><input value={block.credit ?? ''} onChange={(event) => changeBlock(index, { ...block, credit: event.target.value || undefined })} aria-label="이미지 credit" placeholder="credit" className="rounded border p-2" /><label className="rounded border px-3 py-2 text-center text-sm font-semibold">{uploading ? '업로드 중...' : 'PC 이미지 업로드'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadImage(file, (upload) => changeBlock(index, { ...block, src: upload.publicUrl, storagePath: upload.storagePath })) }} /></label></div>
                : block.type === 'list' ? <textarea value={block.items.map(inlineToMarkdown).join('\n')} onChange={(event) => changeBlock(index, { ...block, items: event.target.value.split('\n').map(parseInlineMarkdown) })} className="h-28 w-full rounded border p-3" aria-label="목록 항목" />
                : <textarea value={inlineToMarkdown(block.content)} onChange={(event) => changeBlock(index, { ...block, content: parseInlineMarkdown(event.target.value) })} className="h-28 w-full rounded border p-3" aria-label={`${block.type} 내용`} />}
              {block.type !== 'image' && <p className="mt-1 text-xs text-gray-500">링크: [표시할 글](https://example.com)</p>}
            </div>
          ))}
        </div>
        <button type="button" onClick={() => changeDocument({ ...document, blocks: [...document.blocks, newBlock('paragraph')] })} className="mt-4 rounded border px-4 py-2 text-sm font-semibold">Block 추가</button>
      </div>

      {showPreview && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/60 p-4 md:p-8">
          <div className="mx-auto max-w-[1280px] bg-white p-6 md:p-10">
            <div className="mb-6 flex justify-end"><button type="button" onClick={() => setShowPreview(false)} className="rounded border px-4 py-2 font-semibold">닫기</button></div>
            <article className="max-w-[720px]">
              <h1 className="mb-4 text-2xl font-black leading-tight tracking-tight sm:text-3xl md:text-4xl">{title}</h1>
              <div className="mb-8 border-b border-gray-200 pb-4 text-sm text-gray-500">기사 · 편집 <span className="font-medium text-gray-800">FEEL THE DROP</span></div>
              <ArticleRenderer content={projectedContent} contentBlocks={document} leadingImageUrl={!showCoverInArticle || coverImageMode === 'none' ? null : coverImageMode === 'custom' ? imageUrl : autoLeadingImageUrl} />
            </article>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { useId, useState } from 'react'
import { CONTACT_EMAIL } from '@/lib/site'

export default function CopyEmailButton() {
  const statusId = useId()
  const [status, setStatus] = useState('')
  const [copying, setCopying] = useState(false)

  async function copyEmail() {
    setStatus('')
    setCopying(true)
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL)
      setStatus('이메일 주소를 복사했습니다.')
    } catch {
      setStatus('복사하지 못했습니다. 표시된 이메일 주소를 선택해 직접 복사해주세요.')
    } finally {
      setCopying(false)
    }
  }

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={copyEmail}
        disabled={copying}
        aria-describedby={statusId}
        className="inline-flex min-h-11 cursor-pointer items-center justify-center border border-current px-4 py-2.5 text-sm font-bold transition-opacity hover:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current disabled:cursor-wait disabled:opacity-60"
      >
        이메일 주소 복사
      </button>
      <p id={statusId} role="status" aria-live="polite" aria-atomic="true" className="mt-2 max-w-sm text-xs leading-relaxed">
        {status}
      </p>
    </div>
  )
}

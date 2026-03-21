'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@plusmy/ui'

export function DeleteContextBindingButton({
  workspaceId,
  bindingId
}: {
  workspaceId: string
  bindingId: string
}) {
  const router = useRouter()
  const [status, setStatus] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleClick() {
    setSubmitting(true)
    setStatus(null)

    const response = await fetch('/api/context-bindings', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, binding_id: bindingId })
    })

    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      setStatus(payload?.error ?? 'Binding delete failed.')
      setSubmitting(false)
      return
    }

    setStatus('Binding removed.')
    setSubmitting(false)
    router.refresh()
  }

  return (
    <div className="space-y-2">
      <Button onClick={handleClick} disabled={submitting} tone="secondary" type="button">
        {submitting ? 'Removing…' : 'Remove binding'}
      </Button>
      {status ? <p className="text-xs text-slate-500">{status}</p> : null}
    </div>
  )
}

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ContextBindingType } from '@plusmy/contracts'
import {
  Button,
  Card,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@plusmy/ui'

type SelectOption = {
  id: string
  name: string
  description: string | null
}

const bindingTargetOptions: Record<ContextBindingType, Array<{ value: string; label: string }>> = {
  workspace: [{ value: 'default', label: 'Default workspace context' }],
  provider: [
    { value: 'google', label: 'Google' },
    { value: 'slack', label: 'Slack' },
    { value: 'notion', label: 'Notion' }
  ],
  tool: [
    { value: 'google.search_drive', label: 'Google Drive search' },
    { value: 'google.get_document', label: 'Google Doc read' },
    { value: 'slack.list_channels', label: 'Slack list channels' },
    { value: 'slack.read_channel_history', label: 'Slack read history' },
    { value: 'slack.post_message', label: 'Slack post message' },
    { value: 'notion.search', label: 'Notion search' },
    { value: 'notion.get_page', label: 'Notion read page' },
    { value: 'notion.create_page', label: 'Notion create page' }
  ]
}

const emptySelectionValue = '__none__'

export function ContextBindingForm({
  workspaceId,
  prompts,
  skills
}: {
  workspaceId: string
  prompts: SelectOption[]
  skills: SelectOption[]
}) {
  const router = useRouter()
  const [bindingType, setBindingType] = useState<ContextBindingType>('workspace')
  const [targetKey, setTargetKey] = useState(bindingTargetOptions.workspace[0]?.value ?? 'default')
  const [promptTemplateId, setPromptTemplateId] = useState('')
  const [skillDefinitionId, setSkillDefinitionId] = useState('')
  const [priority, setPriority] = useState('100')
  const [status, setStatus] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const targetOptions = bindingTargetOptions[bindingType]
  const canSubmit = prompts.length > 0 || skills.length > 0

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!promptTemplateId && !skillDefinitionId) {
      setStatus('Choose at least one prompt or skill.')
      return
    }

    setSubmitting(true)
    setStatus(null)

    const response = await fetch('/api/context-bindings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspace_id: workspaceId,
        binding_type: bindingType,
        target_key: targetKey,
        prompt_template_id: promptTemplateId || null,
        skill_definition_id: skillDefinitionId || null,
        priority: Number(priority)
      })
    })

    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      setStatus(payload?.error ?? 'Binding save failed.')
      setSubmitting(false)
      return
    }

    setStatus('Binding saved.')
    setSubmitting(false)
    router.refresh()
  }

  function handleBindingTypeChange(value: ContextBindingType) {
    setBindingType(value)
    setTargetKey(bindingTargetOptions[value][0]?.value ?? 'default')
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Bind prompts and skills</h2>
          <p className="mt-3 text-sm leading-7 text-slate-700">
            Attach workspace-shared prompts and skills to the default workspace context, a provider, or a specific MCP tool.
          </p>
        </div>
      </div>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="binding-type">Binding type</Label>
          <Select value={bindingType} onValueChange={(value) => handleBindingTypeChange(value as ContextBindingType)}>
            <SelectTrigger id="binding-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="workspace">Workspace default</SelectItem>
              <SelectItem value="provider">Provider</SelectItem>
              <SelectItem value="tool">Tool</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="binding-target">Target</Label>
          <Select value={targetKey} onValueChange={setTargetKey}>
            <SelectTrigger id="binding-target">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {targetOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="binding-priority">Priority</Label>
          <Input
            id="binding-priority"
            type="number"
            min={0}
            step={1}
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          />
          <p className="mt-2 text-xs text-muted-foreground">Lower numbers win when multiple bindings target the same surface.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="binding-prompt">Prompt template</Label>
          <Select value={promptTemplateId || emptySelectionValue} onValueChange={(value) => setPromptTemplateId(value === emptySelectionValue ? '' : value)}>
            <SelectTrigger id="binding-prompt">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={emptySelectionValue}>No prompt</SelectItem>
              {prompts.map((prompt) => (
                <SelectItem key={prompt.id} value={prompt.id}>
                  {prompt.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="binding-skill">Skill definition</Label>
          <Select value={skillDefinitionId || emptySelectionValue} onValueChange={(value) => setSkillDefinitionId(value === emptySelectionValue ? '' : value)}>
            <SelectTrigger id="binding-skill">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={emptySelectionValue}>No skill</SelectItem>
              {skills.map((skill) => (
                <SelectItem key={skill.id} value={skill.id}>
                  {skill.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <p className="text-xs leading-6 text-muted-foreground">
          Only workspace-shared prompts and skills can be bound. Personal context stays user-scoped and does not appear here.
        </p>

        <Button disabled={!canSubmit || submitting} type="submit">
          {submitting ? 'Saving…' : 'Create binding'}
        </Button>

        {!canSubmit ? (
          <p className="text-sm text-muted-foreground">Create a workspace-shared prompt or skill before adding a binding.</p>
        ) : null}
        {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
      </form>
    </Card>
  )
}

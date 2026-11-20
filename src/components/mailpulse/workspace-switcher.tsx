'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { UsersRound } from 'lucide-react'
import { api } from '@/lib/api'

type WorkspaceOption = {
  id: string
  name: string
  slug: string
  role: string
}

export function WorkspaceSwitcher() {
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([])
  const [selectedId, setSelectedId] = useState('')

  useEffect(() => {
    let active = true
    api.getWorkspaces().then((data) => {
      if (!active) return
      setWorkspaces(data.workspaces)
      const storedId = window.localStorage.getItem('mailpulse-active-workspace-id')
      const selected = data.workspaces.some((workspace) => workspace.id === storedId)
        ? storedId!
        : data.currentWorkspaceId
      api.setActiveWorkspace(selected)
      setSelectedId(selected)
    }).catch(() => {})
    return () => { active = false }
  }, [])

  if (workspaces.length === 0) return null

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedId)

  return (
    <div className="flex items-center gap-2">
      {workspaces.length > 1 && (
        <select
          aria-label="Current workspace"
          className="h-8 max-w-32 rounded-md border border-input bg-background px-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={selectedId}
          onChange={(event) => {
            api.setActiveWorkspace(event.target.value)
            window.location.reload()
          }}
        >
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
          ))}
        </select>
      )}
      {selectedWorkspace && ['owner', 'admin'].includes(selectedWorkspace.role) && (
        <Link
          href="/workspace"
          aria-label="Manage workspace"
          title="Manage workspace"
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <UsersRound className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Workspace</span>
        </Link>
      )}
    </div>
  )
}

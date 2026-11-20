import { AsyncLocalStorage } from 'node:async_hooks'

export type WorkspaceRole = 'owner' | 'admin' | 'sender' | 'viewer'

export interface WorkspaceContext {
  userId: string
  email: string
  workspaceId: string
  workspaceSlug: string
  workspaceName: string
  role: WorkspaceRole
}

const storage = new AsyncLocalStorage<WorkspaceContext>()

export function runWithWorkspace<T>(context: WorkspaceContext, callback: () => T): T {
  return storage.run(context, callback)
}

export function currentWorkspaceContext(): WorkspaceContext {
  const context = storage.getStore()
  if (!context) throw new Error('A verified workspace context is required for database access.')
  return context
}

export function currentWorkspaceId() {
  return currentWorkspaceContext().workspaceId
}

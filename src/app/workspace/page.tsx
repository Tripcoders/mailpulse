'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Copy, Loader2, MailPlus, RefreshCw, UserMinus, UsersRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SignOutButton } from '@/components/mailpulse/sign-out-button'
import { WorkspaceSwitcher } from '@/components/mailpulse/workspace-switcher'
import { api } from '@/lib/api'

type Workspace = { id: string; name: string; slug: string; role: string }
type Member = {
  id: string
  email: string
  role: string
  createdAt: string
  isCurrentUser: boolean
}
type Invitation = {
  id: string
  email: string
  role: string
  expiresAt: string
  acceptedAt: string | null
  createdAt: string
}

const memberRoles = ['owner', 'admin', 'sender', 'viewer']

export default function WorkspacePage() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('sender')
  const [latestInviteUrl, setLatestInviteUrl] = useState('')
  const [latestInviteEmail, setLatestInviteEmail] = useState('')
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadWorkspace = useCallback(async () => {
    setError('')
    try {
      const result = await api.getWorkspaces()
      const savedId = window.localStorage.getItem('mailpulse-active-workspace-id')
      const selected = result.workspaces.find((item) => item.id === savedId)
        || result.workspaces.find((item) => item.id === result.currentWorkspaceId)
        || result.workspaces[0]
      if (!selected) throw new Error('Your account does not belong to an active workspace.')

      api.setActiveWorkspace(selected.id)
      setWorkspace(selected)
      if (selected.role !== 'owner' && selected.role !== 'admin') {
        setMembers([])
        setInvitations([])
        return
      }

      const [memberResult, invitationResult] = await Promise.all([
        api.getWorkspaceMembers(),
        api.getWorkspaceInvitations(),
      ])
      setMembers(memberResult.members)
      setInvitations(invitationResult.invitations)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Workspace details could not be loaded.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadWorkspace()
  }, [loadWorkspace])

  async function refresh() {
    setRefreshing(true)
    await loadWorkspace()
  }

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    setNotice('')
    setCopied(false)
    try {
      const result = await api.inviteWorkspaceMember(email.trim(), inviteRole)
      setLatestInviteUrl(result.inviteUrl)
      setLatestInviteEmail(result.invitation.email)
      setEmail('')
      setNotice('Invitation link created. Copy it and send it to the invited person.')
      await loadWorkspace()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The invitation could not be created.')
    } finally {
      setSubmitting(false)
    }
  }

  async function copyInviteLink() {
    try {
      await navigator.clipboard.writeText(latestInviteUrl)
      setCopied(true)
      setNotice('Invitation link copied.')
      setError('')
    } catch {
      setNotice('Select the invitation link above and copy it.')
    }
  }

  async function regenerateInvitation(invitation: Invitation) {
    setBusyId(invitation.id)
    setError('')
    setNotice('')
    setCopied(false)
    try {
      const result = await api.inviteWorkspaceMember(invitation.email, invitation.role)
      setLatestInviteUrl(result.inviteUrl)
      setLatestInviteEmail(result.invitation.email)
      setNotice('A fresh invitation link is ready. The previous link has been replaced.')
      await loadWorkspace()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'A new invitation link could not be created.')
    } finally {
      setBusyId('')
    }
  }

  async function revokeInvitation(invitation: Invitation) {
    if (!window.confirm('Revoke the pending invitation for ' + invitation.email + '?')) return
    setBusyId(invitation.id)
    setError('')
    setNotice('')
    try {
      await api.revokeWorkspaceInvitation(invitation.id)
      setInvitations((current) => current.filter((item) => item.id !== invitation.id))
      setNotice('Invitation revoked.')
      if (latestInviteEmail === invitation.email) {
        setLatestInviteUrl('')
        setLatestInviteEmail('')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The invitation could not be revoked.')
    } finally {
      setBusyId('')
    }
  }

  async function changeMemberRole(member: Member, role: string) {
    if (role === member.role) return
    setBusyId(member.id)
    setError('')
    setNotice('')
    try {
      await api.updateWorkspaceMember(member.id, role)
      setMembers((current) => current.map((item) => item.id === member.id ? { ...item, role } : item))
      setNotice('Member role updated.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The member role could not be updated.')
      await loadWorkspace()
    } finally {
      setBusyId('')
    }
  }

  async function removeMember(member: Member) {
    if (!window.confirm('Remove ' + member.email + ' from this workspace?')) return
    setBusyId(member.id)
    setError('')
    setNotice('')
    try {
      await api.removeWorkspaceMember(member.id)
      setMembers((current) => current.filter((item) => item.id !== member.id))
      setNotice('Workspace member removed.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The member could not be removed.')
    } finally {
      setBusyId('')
    }
  }

  const canManage = workspace?.role === 'owner' || workspace?.role === 'admin'

  return (
    <main className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary">
            <ArrowLeft className="h-4 w-4" />
            Campaigns
          </Link>
          <div className="flex items-center gap-2">
            <WorkspaceSwitcher />
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 text-sm font-medium text-primary">
              <UsersRound className="h-4 w-4" />
              Workspace access
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {workspace?.name || 'Workspace'}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage members, roles, and invite links for this workspace.
            </p>
          </div>
          <Button variant="outline" onClick={refresh} disabled={loading || refreshing}>
            {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        </div>

        {error && (
          <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="rounded-md border border-blue-300 bg-blue-50 p-3 text-sm text-blue-950">
            {notice}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center rounded-xl border bg-background py-20 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading workspace access…
          </div>
        ) : !canManage ? (
          <Card>
            <CardHeader>
              <CardTitle>Administrator access required</CardTitle>
              <CardDescription>Ask a workspace owner or administrator to manage members and invitations.</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MailPlus className="h-4 w-4 text-primary" />
                    Invite a member
                  </CardTitle>
                  <CardDescription>
                    The invited person must verify this email address before joining. Links expire after 7 days.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <form className="space-y-4" onSubmit={createInvitation}>
                    <div className="space-y-2">
                      <Label htmlFor="invite-email">Email address</Label>
                      <Input
                        id="invite-email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="teammate@example.com"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="invite-role">Role</Label>
                      <select
                        id="invite-role"
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={inviteRole}
                        onChange={(event) => setInviteRole(event.target.value)}
                      >
                        <option value="sender">Sender — create and send campaigns</option>
                        <option value="viewer">Viewer — view campaigns and reports</option>
                        {workspace?.role === 'owner' && <option value="admin">Administrator — manage members</option>}
                      </select>
                    </div>
                    <Button className="w-full" type="submit" disabled={submitting}>
                      {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MailPlus className="mr-2 h-4 w-4" />}
                      Create invitation link
                    </Button>
                  </form>

                  {latestInviteUrl && (
                    <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                      <div>
                        <p className="text-sm font-medium">Link for {latestInviteEmail}</p>
                        <p className="mt-1 text-xs text-muted-foreground">Anyone with the link still needs the invited email account.</p>
                      </div>
                      <Input aria-label="Invitation link" readOnly value={latestInviteUrl} onFocus={(event) => event.currentTarget.select()} />
                      <Button type="button" variant="outline" className="w-full" onClick={copyInviteLink}>
                        <Copy className="mr-2 h-4 w-4" />
                        {copied ? 'Copied' : 'Copy invitation link'}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Pending invitations</CardTitle>
                  <CardDescription>Creating a fresh link replaces the earlier link for that email.</CardDescription>
                </CardHeader>
                <CardContent>
                  {invitations.filter((item) => !item.acceptedAt).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No pending invitations.</p>
                  ) : (
                    <div className="divide-y">
                      {invitations.filter((item) => !item.acceptedAt).map((invitation) => (
                        <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{invitation.email}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {invitation.role} · expires {new Date(invitation.expiresAt).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <Button size="sm" variant="outline" disabled={busyId === invitation.id} onClick={() => regenerateInvitation(invitation)}>
                              {busyId === invitation.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                              <span className="ml-1.5">New link</span>
                            </Button>
                            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busyId === invitation.id} onClick={() => revokeInvitation(invitation)}>
                              <UserMinus className="h-4 w-4" />
                              <span className="ml-1.5">Revoke</span>
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Workspace members</CardTitle>
                <CardDescription>At least one owner must remain in the workspace.</CardDescription>
              </CardHeader>
              <CardContent>
                {members.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No members were found.</p>
                ) : (
                  <div className="divide-y">
                    {members.map((member) => {
                      const restrictedForAdmin = workspace?.role === 'admin' && !['sender', 'viewer'].includes(member.role)
                      const canRemove = !member.isCurrentUser && (workspace?.role === 'owner' || ['sender', 'viewer'].includes(member.role))
                      return (
                        <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {member.email}
                              {member.isCurrentUser && <span className="ml-2 text-xs font-normal text-muted-foreground">You</span>}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Joined {new Date(member.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <select
                              aria-label={'Role for ' + member.email}
                              className="h-9 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              value={member.role}
                              disabled={member.isCurrentUser || restrictedForAdmin || busyId === member.id}
                              onChange={(event) => changeMemberRole(member, event.target.value)}
                            >
                              {memberRoles.map((role) => (
                                <option
                                  key={role}
                                  value={role}
                                  disabled={(workspace?.role !== 'owner' && role === 'owner') || (workspace?.role === 'admin' && role === 'admin')}
                                >
                                  {role}
                                </option>
                              ))}
                            </select>
                            {canRemove && (
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label={'Remove ' + member.email}
                                title="Remove member"
                                disabled={busyId === member.id}
                                onClick={() => removeMember(member)}
                              >
                                {busyId === member.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserMinus className="h-4 w-4 text-destructive" />}
                              </Button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </main>
  )
}

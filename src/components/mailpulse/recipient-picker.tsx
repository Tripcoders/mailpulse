'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import {
  UploadCloud, FileSpreadsheet, Download, Sparkles, Loader2, Plus, X, Search,
  Users, CheckCircle2, ClipboardText, Trash2, Mail, UserPlus,
} from './icons'
import { DuoTile } from './icons'
import {
  MAX_RECIPIENTS, deriveCompany, deriveDisplayName, emailDomain,
  mergeRecipients, parsePastedEmails,
} from '@/lib/email-paste'
import type { Recipient } from '@/lib/types'

type RecipientMode = 'csv' | 'paste'
type RecipientSource = 'csv' | 'paste' | 'demo' | null
type SortKey = 'added' | 'name' | 'email' | 'company'

const VISIBLE_LIMIT = 100

const SOURCE_LABEL: Record<Exclude<RecipientSource, null>, string> = {
  csv: 'CSV import',
  paste: 'Pasted list',
  demo: 'Demo data',
}

interface RecipientPickerProps {
  recipients: Recipient[]
  csvMeta: any
  parsing: boolean
  mode: RecipientMode
  source: RecipientSource
  pasteText: string
  onRecipientsChange: (recipients: Recipient[]) => void
  onCsvMetaChange: (meta: any) => void
  onCsvFile: (file: File) => void
  onModeChange: (mode: RecipientMode) => void
  onSourceChange: (source: RecipientSource) => void
  onPasteTextChange: (value: string) => void
  onLoadDemo: () => void
  onDownloadSample: () => void
}

function Stat({ label, value, tone = 'default' }: { label: string; value: number | string; tone?: 'default' | 'emerald' | 'amber' | 'rose' }) {
  const tones: Record<string, string> = {
    default: 'text-foreground',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
    rose: 'text-rose-600 dark:text-rose-400',
  }
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${tones[tone]}`}>{value}</p>
    </div>
  )
}

export function RecipientPicker({
  recipients,
  csvMeta,
  parsing,
  mode,
  source,
  pasteText,
  onRecipientsChange,
  onCsvMetaChange,
  onCsvFile,
  onModeChange,
  onSourceChange,
  onPasteTextChange,
  onLoadDemo,
  onDownloadSample,
}: RecipientPickerProps) {
  const [dragOver, setDragOver] = useState(false)
  const [singleName, setSingleName] = useState('')
  const [singleEmail, setSingleEmail] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('added')

  const stats = useMemo(() => parsePastedEmails(pasteText), [pasteText])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const enriched = recipients.map((recipient) => {
      const company = recipient.company?.trim() || deriveCompany(recipient.email)
      return {
        ...recipient,
        displayName: recipient.name.trim() || deriveDisplayName(recipient.email),
        company,
        domain: emailDomain(recipient.email),
      }
    })
    const filtered = q
      ? enriched.filter((r) =>
          r.displayName.toLowerCase().includes(q) ||
          r.email.toLowerCase().includes(q) ||
          r.company.toLowerCase().includes(q) ||
          r.domain.includes(q),
        )
      : enriched
    const sorted = [...filtered]
    if (sort === 'name') sorted.sort((a, b) => a.displayName.localeCompare(b.displayName))
    if (sort === 'email') sorted.sort((a, b) => a.email.localeCompare(b.email))
    if (sort === 'company') sorted.sort((a, b) => a.company.localeCompare(b.company) || a.displayName.localeCompare(b.displayName))
    return sorted
  }, [recipients, query, sort])

  const visible = rows.slice(0, VISIBLE_LIMIT)
  const missingNames = recipients.filter((r) => !r.name.trim()).length
  const sourceLabel = source === 'paste' && csvMeta ? 'CSV + pasted' : source ? SOURCE_LABEL[source] : ''

  // ── Bulk paste ──
  const applyPaste = () => {
    if (stats.recipients.length === 0) {
      toast.error('No valid email addresses found in the pasted text')
      return
    }
    const merged = mergeRecipients(recipients, stats.recipients)
    onRecipientsChange(merged.recipients)
    onSourceChange('paste')
    onPasteTextChange('')
    if (merged.overflow > 0) {
      toast.error(`Recipient limit is ${MAX_RECIPIENTS.toLocaleString()} — added ${merged.added}, skipped ${merged.overflow}.`)
      return
    }
    if (merged.added > 0) {
      const bits = [`Added ${merged.added} recipient${merged.added === 1 ? '' : 's'}`]
      if (merged.updated > 0) bits.push(`filled ${merged.updated} existing name${merged.updated === 1 ? '' : 's'}`)
      if (merged.duplicates > 0) bits.push(`${merged.duplicates} already in the list`)
      toast.success(bits.join(' · '))
    } else if (merged.updated > 0) {
      toast.success(`Updated details for ${merged.updated} existing recipient${merged.updated === 1 ? '' : 's'}`)
    } else {
      toast.info('Those emails are already in your list')
    }
  }

  // ── One at a time ──
  const addSingle = () => {
    const raw = singleEmail.trim()
    if (!raw) {
      toast.error('Enter an email address first')
      return
    }
    const parsed = parsePastedEmails(raw)
    if (parsed.recipients.length === 0) {
      toast.error('That does not look like a valid email address')
      return
    }
    const typedName = singleName.trim()
    const incoming: Recipient[] = parsed.recipients.map((r) => ({
      ...r,
      name: r.name || (parsed.recipients.length === 1 ? typedName : ''),
    }))
    const merged = mergeRecipients(recipients, incoming)
    if (merged.added === 0 && merged.updated === 0) {
      toast.info('Already in your list')
      setSingleEmail('')
      return
    }
    onRecipientsChange(merged.recipients)
    onSourceChange('paste')
    setSingleEmail('')
    setSingleName('')
    if (merged.overflow > 0) {
      toast.error(`Recipient limit is ${MAX_RECIPIENTS.toLocaleString()} — skipped ${merged.overflow}.`)
    } else {
      toast.success(merged.added > 0
        ? `Added ${merged.added} recipient${merged.added === 1 ? '' : 's'}`
        : `Updated ${merged.updated} existing recipient${merged.updated === 1 ? '' : 's'}`)
    }
  }

  // ── List management ──
  const rename = (email: string, name: string) => {
    onRecipientsChange(recipients.map((r) => (r.email === email ? { ...r, name } : r)))
  }
  const remove = (email: string) => {
    const next = recipients.filter((r) => r.email !== email)
    onRecipientsChange(next)
    if (next.length === 0) onSourceChange(null)
    toast.info('Recipient removed')
  }
  const clearAll = () => {
    onRecipientsChange([])
    onCsvMetaChange(null)
    onSourceChange(null)
    setQuery('')
    toast.info('Recipient list cleared')
  }
  const fillMissingNames = () => {
    if (missingNames === 0) return
    onRecipientsChange(recipients.map((r) => (r.name.trim() ? r : { ...r, name: deriveDisplayName(r.email) })))
    toast.success(`Filled ${missingNames} missing name${missingNames === 1 ? '' : 's'} from email addresses — edit any that look off`)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <DuoTile icon={Users} size="sm" /> Build your recipient list
            <Badge variant="secondary" className="text-[10px]">Required</Badge>
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Upload a CSV, paste a whole list, or add people one at a time. Every route validates addresses,
            removes duplicates, and feeds the same compose → attach → send flow.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onDownloadSample}>
            <Download className="h-3.5 w-3.5" /> Sample CSV
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onLoadDemo}>
            <Sparkles className="h-3.5 w-3.5" /> Demo data
          </Button>
        </div>
      </div>

      {/* Entry mode */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 rounded-xl border bg-muted/30 p-1.5" role="tablist" aria-label="Recipient entry method">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'csv'}
          onClick={() => onModeChange('csv')}
          className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 ${
            mode === 'csv'
              ? 'bg-card text-foreground shadow-sm ring-1 ring-border'
              : 'text-muted-foreground hover:text-foreground hover:bg-card/60'
          }`}
        >
          <FileSpreadsheet className="h-4 w-4" />
          <span>Upload CSV</span>
          <span className="hidden md:inline text-[10px] font-normal text-muted-foreground">spreadsheet</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'paste'}
          onClick={() => onModeChange('paste')}
          className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 ${
            mode === 'paste'
              ? 'bg-card text-foreground shadow-sm ring-1 ring-border'
              : 'text-muted-foreground hover:text-foreground hover:bg-card/60'
          }`}
        >
          <ClipboardText className="h-4 w-4" />
          <span>Paste emails</span>
          <span className="hidden md:inline text-[10px] font-normal text-muted-foreground">no CSV needed</span>
        </button>
      </div>

      {/* CSV mode */}
      {mode === 'csv' && (
        <div className="space-y-3">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              const file = e.dataTransfer.files?.[0]
              if (file) onCsvFile(file)
            }}
            onClick={() => document.getElementById('csv-file-input')?.click()}
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
              dragOver ? 'border-brand bg-blue-500/10 scale-[1.01]' : 'border-border hover:border-brand/60 hover:bg-muted/40'
            }`}
          >
            <input
              id="csv-file-input"
              type="file"
              accept=".csv,.txt,text/csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onCsvFile(f); e.currentTarget.value = '' }}
            />
            <div className="flex flex-col items-center gap-3">
              <div className="h-14 w-14 rounded-full bg-blue-500/10 flex items-center justify-center">
                {parsing ? <Loader2 className="h-7 w-7 text-brand animate-spin" /> : <UploadCloud className="h-7 w-7 text-brand" />}
              </div>
              <div>
                <p className="font-medium">{parsing ? 'Parsing your CSV…' : 'Drop your CSV here, or click to browse'}</p>
                <p className="text-xs text-muted-foreground mt-1">Headers like email, name — up to {MAX_RECIPIENTS.toLocaleString()} recipients</p>
              </div>
            </div>
          </div>

          {csvMeta && recipients.length > 0 && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Valid recipients" value={recipients.length} tone="emerald" />
                <Stat label="Total rows" value={csvMeta.totalRows ?? recipients.length} />
                <Stat label="Duplicates removed" value={csvMeta.duplicatesRemoved ?? 0} tone="amber" />
                <Stat label="Invalid emails" value={csvMeta.invalid ?? 0} tone="rose" />
              </div>
              <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                <span>Email column: <code className="bg-muted px-1.5 py-0.5 rounded">{csvMeta.detectedEmailColumn || 'email'}</code></span>
                {csvMeta.detectedNameColumn && <span>Name column: <code className="bg-muted px-1.5 py-0.5 rounded">{csvMeta.detectedNameColumn}</code></span>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Paste mode */}
      {mode === 'paste' && (
        <div className="space-y-4">
          <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <Label htmlFor="paste-emails" className="text-sm font-medium flex items-center gap-1.5">
                  <ClipboardText className="h-4 w-4 text-brand" /> Paste emails in bulk
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  One per line, comma separated, or straight from a spreadsheet. Names and companies are picked
                  up when present — <span className="text-foreground/80">Jane Doe &lt;jane@acme.com&gt;</span>,{' '}
                  <span className="text-foreground/80">jane@acme.com, Jane Doe</span>, or just the raw addresses.
                </p>
              </div>
              {pasteText.trim() && (
                <Button variant="ghost" size="sm" className="h-7 text-xs shrink-0 text-muted-foreground" onClick={() => onPasteTextChange('')}>
                  Clear
                </Button>
              )}
            </div>

            <Textarea
              id="paste-emails"
              value={pasteText}
              onChange={(e) => onPasteTextChange(e.target.value)}
              rows={5}
              spellCheck={false}
              placeholder={'jane@acme.com\nJohn Smith <john@company.com>\npriya@example.com, Priya Sharma\nAcme Inc <hello@acme.com>'}
              className="font-mono text-xs leading-relaxed resize-y min-h-28 bg-card"
            />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="tabular-nums">Found {stats.totalFound}</Badge>
                <Badge variant="outline" className="tabular-nums border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300">
                  {stats.recipients.length} ready
                </Badge>
                {stats.duplicatesRemoved > 0 && (
                  <Badge variant="outline" className="tabular-nums border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                    {stats.duplicatesRemoved} duplicate{stats.duplicatesRemoved === 1 ? '' : 's'}
                  </Badge>
                )}
                {stats.invalid.length > 0 && (
                  <Badge variant="outline" className="tabular-nums border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300">
                    {stats.invalid.length} invalid
                  </Badge>
                )}
                {stats.namedCount > 0 && (
                  <Badge variant="outline" className="tabular-nums">{stats.namedCount} with names</Badge>
                )}
              </div>
              <Button
                onClick={applyPaste}
                disabled={stats.recipients.length === 0 || recipients.length >= MAX_RECIPIENTS}
                className="bg-brand text-white hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" /> Add {stats.recipients.length || ''} to list
              </Button>
            </div>

            {pasteText.trim() && stats.totalFound === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                No email addresses detected yet. Check the format — each address needs an @ and a domain like .com.
              </p>
            )}
            {stats.invalid.length > 0 && (
              <p className="text-[11px] text-muted-foreground break-words">
                Ignored: <span className="text-rose-600 dark:text-rose-400 font-mono">{stats.invalid.slice(0, 6).join(', ')}</span>
                {stats.invalid.length > 6 ? ` +${stats.invalid.length - 6} more` : ''}
              </p>
            )}
          </div>

          <div className="rounded-xl border bg-card p-4 space-y-3">
            <div>
              <p className="text-sm font-medium flex items-center gap-1.5"><UserPlus className="h-4 w-4 text-brand" /> Add one at a time</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Paste a single email and press Enter — or keep adding them one by one. Great for a handful of targeted sends.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.2fr_auto] gap-2 items-end">
              <div>
                <Label htmlFor="single-name" className="text-[11px] text-muted-foreground">Name / company (optional)</Label>
                <Input
                  id="single-name"
                  value={singleName}
                  onChange={(e) => setSingleName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('single-email')?.focus() } }}
                  placeholder="Jane Doe"
                  className="h-9 mt-1"
                />
              </div>
              <div>
                <Label htmlFor="single-email" className="text-[11px] text-muted-foreground">Email address</Label>
                <Input
                  id="single-email"
                  value={singleEmail}
                  onChange={(e) => setSingleEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSingle() } }}
                  placeholder="jane@acme.com"
                  inputMode="email"
                  autoComplete="off"
                  className="h-9 mt-1"
                />
              </div>
              <Button variant="outline" onClick={addSingle} disabled={recipients.length >= MAX_RECIPIENTS} className="h-9">
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Mail className="h-3 w-3" /> Pasting several addresses into the email field adds them all at once.
            </p>
          </div>
        </div>
      )}

      {/* Shared recipient list */}
      {recipients.length > 0 ? (
        <div className="rounded-xl border overflow-hidden bg-card">
          <div className="flex items-center justify-between gap-3 flex-wrap border-b bg-muted/40 px-4 py-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="h-8 w-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-300 flex items-center justify-center shrink-0">
                <Users className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold flex items-center gap-2 flex-wrap">
                  Current list
                  {source && <Badge variant="outline" className="text-[10px] font-normal">{sourceLabel}</Badge>}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {recipients.length} valid email{recipients.length === 1 ? '' : 's'} · ready for compose, attachments and send
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter name, email or company…"
                  className="h-8 w-56 pl-8 text-xs"
                  aria-label="Filter recipients"
                />
              </div>
              <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                <SelectTrigger className="h-8 w-36 text-xs" aria-label="Sort recipients">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="added">Recently added</SelectItem>
                  <SelectItem value="name">Name A–Z</SelectItem>
                  <SelectItem value="email">Email A–Z</SelectItem>
                  <SelectItem value="company">Company A–Z</SelectItem>
                </SelectContent>
              </Select>
              {missingNames > 0 && (
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={fillMissingNames} title="Guess names from the email address and fill the blank ones">
                  <Sparkles className="h-3.5 w-3.5" /> Fill {missingNames} name{missingNames === 1 ? '' : 's'}
                </Button>
              )}
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto scroll-thin">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium w-[38%]">Name</th>
                  <th className="px-3 py-2 font-medium">Email address</th>
                  <th className="px-3 py-2 font-medium hidden md:table-cell">Company / domain</th>
                  <th className="px-3 py-2 font-medium w-10"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No recipients match “{query}”.
                    </td>
                  </tr>
                ) : visible.map((r) => (
                  <tr key={r.email} className="border-t border-border/70 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-1.5">
                      <input
                        value={r.name}
                        onChange={(e) => rename(r.email, e.target.value)}
                        placeholder={deriveDisplayName(r.email)}
                        aria-label={`Name for ${r.email}`}
                        className="w-full bg-transparent text-sm font-medium text-foreground rounded-md px-1.5 py-1 -mx-1.5 outline-none transition-colors placeholder:text-muted-foreground/60 hover:bg-muted/50 focus:bg-muted/70 focus:ring-1 focus:ring-ring"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="text-sm text-foreground/90 truncate block max-w-[22rem]" title={r.email}>{r.email}</span>
                    </td>
                    <td className="px-3 py-1.5 hidden md:table-cell">
                      <span className="text-xs text-muted-foreground truncate block max-w-[12rem]" title={r.domain}>
                        {r.company}
                        <span className="opacity-60"> · {r.domain}</span>
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => remove(r.email)}
                        aria-label={`Remove ${r.email}`}
                        title="Remove recipient"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap border-t px-4 py-2 text-xs text-muted-foreground">
            <span className="tabular-nums">
              Showing {visible.length} of {rows.length}
              {query.trim() ? ` matching “${query.trim()}”` : ''} · {recipients.length} total
              {rows.length > VISIBLE_LIMIT ? ` · filter to narrow the list` : ''}
            </span>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" /> Remove all
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear the recipient list?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes all {recipients.length} recipients from this campaign. Your compose content and settings stay intact.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep list</AlertDialogCancel>
                  <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={clearAll}>
                    Remove all
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed bg-muted/20 px-4 py-6 text-center">
          <Users className="h-7 w-7 mx-auto text-muted-foreground/50 mb-2" />
          <p className="text-sm font-medium">No recipients yet</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Paste a list above, add one email at a time, or switch to CSV upload. Even a single address is enough to continue.
          </p>
        </div>
      )}

      {recipients.length > 0 && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          Names are editable inline. Blank names fall back to the email address when sending, and{' '}
          <b className="font-medium text-foreground">Fill missing names</b> turns addresses like jane.doe@acme.com into “Jane Doe”.
        </p>
      )}
    </div>
  )
}

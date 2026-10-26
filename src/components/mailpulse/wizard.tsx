'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  UploadCloud, FileSpreadsheet, ArrowRight, ArrowLeft, Send, Paperclip, X,
  Mail, PenLine, ImageIcon, CheckCircle2, AlertTriangle, Loader2,
  Save, FileText, ShieldCheck, Zap, Settings2, User, Link2, Bold, Italic,
  Eye, Sparkles, Download, RotateCcw, Trash2, CircleAlert, Info,
  History, DuoTile,
} from './icons'
import { api } from '@/lib/api'
import { formatBytes } from './helpers'
import type { Recipient, StagedAttachment, Signature, EmailTemplate, ProviderType, Suggestion } from '@/lib/types'

interface WizardProps {
  onLaunched: (sessionId: string) => void
  onCancel: () => void
}

const STEPS = [
  { title: 'Upload CSV', icon: UploadCloud, hint: 'Recipient list (.csv)' },
  { title: 'Compose', icon: PenLine, hint: 'Subject + body + signature' },
  { title: 'Attachments', icon: Paperclip, hint: 'Optional files' },
  { title: 'Sender & SMTP', icon: ShieldCheck, hint: 'From + provider + login' },
  { title: 'Review & Launch', icon: Send, hint: 'Checklist + send' },
]

// Logos pulled live from a public logo API (Simple Icons CDN — no key required).
// Each provider shows its brand mark so you can tell SMTPs apart at a glance.
const LOGO = (slug: string) => `https://cdn.simpleicons.org/${slug}`
const FAVICON = (domain: string) => `https://www.google.com/s2/favicons?domain=${domain}&sz=64`

const PROVIDERS: { value: ProviderType; label: string; hint: string; logo: string | null; fallbackLogo: string | null; helpUrl: string | null; helpLabel: string }[] = [
  { value: 'gmail', label: 'Gmail', hint: 'smtp.gmail.com · 465 SSL', logo: LOGO('gmail'), fallbackLogo: FAVICON('mail.google.com'), helpUrl: 'https://myaccount.google.com/apppasswords', helpLabel: 'How to get a Gmail app password →' },
  { value: 'yahoo', label: 'Yahoo Mail', hint: 'smtp.mail.yahoo.com · 465 SSL', logo: LOGO('yahoo'), fallbackLogo: FAVICON('mail.yahoo.com'), helpUrl: 'https://help.yahoo.com/kb/generate-manage-third-party-passwords-sln15241.html', helpLabel: 'How to get a Yahoo app password →' },
  { value: 'outlook', label: 'Outlook / O365', hint: 'smtp.office365.com · 587 STARTTLS', logo: LOGO('microsoftoutlook'), fallbackLogo: FAVICON('outlook.live.com'), helpUrl: 'https://support.microsoft.com/en-us/account-billing/using-app-passwords-with-apps-that-don-t-support-two-step-verification-5896ed9b-4263-e681-128a-a6f2979a7944', helpLabel: 'How to get an Outlook app password →' },
  { value: 'icloud', label: 'iCloud Mail', hint: 'smtp.mail.me.com · 587 STARTTLS', logo: LOGO('icloud'), fallbackLogo: FAVICON('icloud.com'), helpUrl: 'https://support.apple.com/en-us/102654', helpLabel: 'How to get an iCloud app-specific password →' },
  { value: 'zoho', label: 'Zoho Mail', hint: 'smtp.zoho.com · 465 SSL', logo: LOGO('zoho'), fallbackLogo: FAVICON('zoho.com'), helpUrl: 'https://help.zoho.com/portal/en/kb/zoho-accounts/manage-your-profile/article/app-passwords', helpLabel: 'How to get a Zoho app password →' },
  { value: 'sendgrid', label: 'SendGrid', hint: 'smtp.sendgrid.net · 587 STARTTLS', logo: LOGO('sendgrid'), fallbackLogo: FAVICON('sendgrid.com'), helpUrl: 'https://docs.sendgrid.com/ui/account-and-settings/api-keys', helpLabel: 'How to create a SendGrid API key →' },
  { value: 'mailgun', label: 'Mailgun', hint: 'smtp.mailgun.org · 587 STARTTLS', logo: LOGO('mailgun'), fallbackLogo: FAVICON('mailgun.com'), helpUrl: 'https://documentation.mailgun.com/en/latest/user_manual.html#smtp-credentials', helpLabel: 'Where to find Mailgun SMTP credentials →' },
  { value: 'ses', label: 'Amazon SES', hint: 'email-smtp.us-east-1 · 587 STARTTLS', logo: LOGO('amazonwebservices'), fallbackLogo: FAVICON('aws.amazon.com'), helpUrl: 'https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html', helpLabel: 'How to get SES SMTP credentials →' },
  { value: 'smtp', label: 'Custom SMTP', hint: 'Any host — enter host & port', logo: null, fallbackLogo: null, helpUrl: null, helpLabel: '' },
]

const DEMO_RECIPIENTS: Recipient[] = [
  { email: 'jane@example.com', name: 'Jane Doe' },
  { email: 'carlos@example.com', name: 'Carlos Rivera' },
  { email: 'priya@example.com', name: 'Priya Sharma' },
]
const DEMO_SUBJECT = 'Hi {{name}}, your November update is here'
const DEMO_BODY = `<p>Hello {{name}},</p>\n<p>This is a <b>demo preview</b> of your personalized campaign. Every recipient sees their own name, and <i>{{email}}</i> is filled in automatically.</p>\n<p><a href="https://example.com">View your dashboard →</a></p>`

function ProviderLogo({ provider, size = 22 }: { provider: { value: string; label: string; logo: string | null; fallbackLogo?: string | null }; size?: number }) {
  const [stage, setStage] = useState(0)
  const loadedRef = useRef(false)
  const src = stage === 0 ? provider.logo : provider.fallbackLogo
  // Advance to the next source if the current one hasn't loaded within 4s
  // (covers CDNs that hang without firing onError, plus 404s).
  useEffect(() => {
    loadedRef.current = false
    if (!src || stage > 1) return
    const t = setTimeout(() => {
      if (!loadedRef.current) setStage((s) => s + 1)
    }, 4000)
    return () => clearTimeout(t)
  }, [src, stage])
  if (!src || stage > 1) {
    return (
      <span
        className="rounded-md bg-muted flex items-center justify-center font-bold text-muted-foreground shrink-0"
        style={{ width: size, height: size, fontSize: size * 0.5 }}
        aria-hidden
      >
        {provider.label.charAt(0)}
      </span>
    )
  }
  return (
    <img
      src={src}
      alt={`${provider.label} logo`}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className="object-contain shrink-0"
      loading="lazy"
      onLoad={() => { loadedRef.current = true }}
      onError={() => setStage((s) => s + 1)}
    />
  )
}

export function Wizard({ onLaunched, onCancel }: WizardProps) {
  const [step, setStep] = useState(0)
  const [sessionName, setSessionName] = useState('')
  const [sessionColor, setSessionColor] = useState('#3b82f6')

  // Step 1: CSV
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [csvMeta, setCsvMeta] = useState<any>(null)
  const [parsing, setParsing] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Step 2: Compose
  const [subject, setSubject] = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  const [signatureText, setSignatureText] = useState('')
  const [signatureImage, setSignatureImage] = useState<string>('')
  const [signatures, setSignatures] = useState<Signature[]>([])
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [saveSigOpen, setSaveSigOpen] = useState(false)
  const [saveTplOpen, setSaveTplOpen] = useState(false)
  const [sigName, setSigName] = useState('')
  const [tplName, setTplName] = useState('')

  // Step 3: Attachments
  const [attachments, setAttachments] = useState<StagedAttachment[]>([])
  const [attDragOver, setAttDragOver] = useState(false)
  const [uploadingAtt, setUploadingAtt] = useState(false)
  const attInputRef = useRef<HTMLInputElement>(null)

  // Step 4: SMTP
  const [fromName, setFromName] = useState('')
  const [fromEmail, setFromEmail] = useState('')
  const [providerType, setProviderType] = useState<ProviderType>('gmail')
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('587')
  const [smtpSecure, setSmtpSecure] = useState(false)
  const [smtpUser, setSmtpUser] = useState('')
  const [smtpPass, setSmtpPass] = useState('')
  const [batchSize, setBatchSize] = useState('10')
  const [batchDelayMs, setBatchDelayMs] = useState('2000')
  const [perEmailDelayMs, setPerEmailDelayMs] = useState('500')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const [launching, setLaunching] = useState(false)

  // ── Persistence: profiles (remembered SMTP), settings, draft autosave, suggestions ──
  const [profiles, setProfiles] = useState<any[]>([])
  const [rememberPass, setRememberPass] = useState(false)
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [draftInfo, setDraftInfo] = useState<{ updatedAt: string; content: Record<string, any> } | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [suggestionsOpen, setSuggestionsOpen] = useState(true)
  const [recovered, setRecovered] = useState(false)
  const bootstrappedRef = useRef(false)
  const draftTimer = useRef<any>(null)
  const suggestTimer = useRef<any>(null)

  // Load signatures + templates on mount
  useEffect(() => {
    api.listSignatures().then((d) => setSignatures(d.signatures as Signature[])).catch(() => {})
    api.listTemplates().then((d) => setTemplates(d.templates as EmailTemplate[])).catch(() => {})
  }, [])

  // ── Bootstrap: load saved profiles, remembered settings and the auto-saved draft ──
  useEffect(() => {
    let alive = true
    ;(async () => {
      const [profilesRes, settingsRes, draftRes] = await Promise.all([
        api.listProfiles().catch(() => ({ profiles: [] })),
        api.getSettings().catch(() => ({ settings: {} as any })),
        api.getDraft().catch(() => ({ draft: null })),
      ])
      if (!alive) return
      setProfiles(profilesRes.profiles || [])

      // Remembered settings: default to the last used provider + throttles.
      const s = settingsRes.settings || {}
      const last = s.lastCampaign as any
      if (last) {
        if (last.providerType) setProviderType(last.providerType)
        if (last.batchSize) setBatchSize(last.batchSize)
        if (last.batchDelayMs) setBatchDelayMs(last.batchDelayMs)
        if (last.perEmailDelayMs) setPerEmailDelayMs(last.perEmailDelayMs)
      }

      // Unfinished-work draft from a previous run (crash / refresh safe).
      if (draftRes.draft) {
        try { setDraftInfo({ updatedAt: draftRes.draft.updatedAt, content: JSON.parse(draftRes.draft.content) }) } catch {}
      }
      bootstrappedRef.current = true
    })()
    return () => { alive = false }
  }, [])

  // ── Snapshot of wizard state for autosave/suggestions (never includes the password) ──
  const snapshot = () => ({
    sessionName, sessionColor, recipients, csvMeta,
    subject, bodyHtml, signatureText, signatureImage, attachments,
    fromName, fromEmail, providerType, smtpUser,
    batchSize, batchDelayMs, perEmailDelayMs,
    savedAt: new Date().toISOString(),
  })
  const kafkaDeps = [sessionName, sessionColor, recipients, csvMeta, subject, bodyHtml, signatureText, signatureImage, attachments, fromName, fromEmail, providerType, smtpUser, batchSize, batchDelayMs, perEmailDelayMs]

  // ── Autosave: debounced 1.2s after any change, so a crash/power-cut never
  //    loses work. Runs after initial bootstrap: user edits win over the draft.
  useEffect(() => {
    if (!bootstrappedRef.current) return
    window.clearTimeout(draftTimer.current)
    draftTimer.current = window.setTimeout(() => {
      api.saveDraft(snapshot()).catch(() => {})
    }, 1200)
    return () => window.clearTimeout(draftTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, kafkaDeps)

  // ── Smart suggestions: debounced refresh from the local engine ──
  const refreshSuggestions = useCallback(() => {
    window.clearTimeout(suggestTimer.current)
    suggestTimer.current = window.setTimeout(() => {
      api.suggest({
        recipientsCount: recipients.length,
        fromEmail, providerType, subject, bodyHtml,
        batchSize: Number(batchSize), batchDelayMs: Number(batchDelayMs), perEmailDelayMs: Number(perEmailDelayMs),
        attachmentsTotalMB: attachments.reduce((sum, a) => sum + a.size, 0) / 1024 / 1024,
      }).then((d) => setSuggestions(d.suggestions || [])).catch(() => {})
    }, 1200)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, kafkaDeps)
  useEffect(() => { refreshSuggestions() }, kafkaDeps)

  // ── Resume / discard the auto-saved draft ──
  const restoreDraft = async () => {
    if (!draftInfo?.content) return
    const c = draftInfo.content
    try {
      if (c.sessionName) setSessionName(c.sessionName)
      if (c.sessionColor) setSessionColor(c.sessionColor)
      if (Array.isArray(c.recipients)) setRecipients(c.recipients)
      if (c.csvMeta) setCsvMeta(c.csvMeta)
      setSubject(c.subject || '')
      setBodyHtml(c.bodyHtml || '')
      setSignatureText(c.signatureText || '')
      setSignatureImage(c.signatureImage || '')
      if (Array.isArray(c.attachments)) setAttachments(c.attachments)
      setFromName(c.fromName || '')
      setFromEmail(c.fromEmail || '')
      if (c.providerType) setProviderType(c.providerType)
      setSmtpUser(c.smtpUser || '')
      if (c.batchSize) setBatchSize(c.batchSize)
      if (c.batchDelayMs) setBatchDelayMs(c.batchDelayMs)
      if (c.perEmailDelayMs) setPerEmailDelayMs(c.perEmailDelayMs)
      await api.clearDraft().catch(() => {})
      setDraftInfo(null)
      setRecovered(true)
      toast.success('Progress restored — continue where you left off')
    } catch {
      toast.error('Could not restore — starting fresh')
      setDraftInfo(null)
    }
  }
  const discardDraft = async () => {
    await api.clearDraft().catch(() => {})
    setDraftInfo(null)
    toast.info('Old draft discarded')
  }

  // Apply a suggestion (provider switch / throttle preset / saved profile).
  const applySuggestion = async (s: Suggestion) => {
    const a = s.apply || {}
    if (a.type === 'provider') {
      if (a.providerType) setProviderType(a.providerType)
      if (a.smtpHost) setSmtpHost(a.smtpHost)
      if (a.smtpPort) { setSmtpPort(a.smtpPort); setSmtpSecure(a.smtpSecure ?? a.smtpPort === '465') }
      toast.success('Provider preset applied')
    } else if (a.type === 'throttle') {
      if (a.batchSize) setBatchSize(a.batchSize)
      if (a.batchDelayMs) setBatchDelayMs(a.batchDelayMs)
      if (a.perEmailDelayMs) setPerEmailDelayMs(a.perEmailDelayMs)
      toast.success('Throttling preset applied')
    } else if (a.type === 'profile') {
      useProfile(a.profileId)
      toast.success(`Saved identity applied — ${a.smtpUser}`)
    }
    setSuggestions((prev) => prev.filter((x) => x.id !== s.id))
  }

  // Apply a saved profile (fills everything except the password; if the password
  // is remembered on this computer, launching needs no retyping at all).
  const useProfile = (p: any) => {
    const profile = typeof p === 'string' ? profiles.find((x) => x.id === p) : p
    if (!profile) return
    setProviderType(profile.providerType)
    setFromName(profile.fromName)
    setFromEmail(profile.fromEmail)
    setSelectedProfileId(profile.id)
    setSmtpUser(profile.smtpUser)
    if (profile.smtpHost) setSmtpHost(profile.smtpHost)
    if (profile.smtpPort) { setSmtpPort(String(profile.smtpPort)); setSmtpSecure(profile.smtpSecure) }
    setTestResult(profile.hasPassword ? { ok: true, message: 'Saved profile ready — sends with the remembered password (no retyping)' } : null)
  }
  const removeProfile = async (id: string) => {
    try {
      await api.deleteProfile(id)
      setProfiles((prev) => prev.filter((p) => p.id !== id))
      if (selectedProfileId === id) setSelectedProfileId(null)
      toast.success('Saved identity deleted')
    } catch (e: any) {
      toast.error(e.message || 'Delete failed')
    }
  }

  // Persist an identity (encrypted server-side) — called after a verified test
  // or a successful launch when "remember" is checked.
  const persistProfile = () => {
    if (!rememberPass || !smtpUser || !smtpPass) return
    api.saveProfile({
      providerType, fromName, fromEmail, smtpHost, smtpPort: Number(smtpPort),
      smtpSecure, smtpUser, smtpPass, setDefault: true,
    }).then((d) => {
      setProfiles((prev) => [d.profile, ...prev.filter((p) => p.id !== d.profile.id)])
      setSelectedProfileId(d.profile.id)
      toast.success('Identity saved — next session needs no re-typing')
    }).catch(() => {})
  }

  // Auto-fill SMTP host/port hint when a preset provider is picked
  useEffect(() => {
    const p = PROVIDERS.find((x) => x.value === providerType)
    if (!p || providerType === 'smtp') return
    // Parse host + port out of the hint so the Review tab always shows real values
    const m = p.hint.match(/([\w.\-]+)\s·\s(\d+)/)
    if (m) {
      setSmtpHost(m[1])
      setSmtpPort(m[2])
      setSmtpSecure(m[2] === '465')
    }
  }, [providerType])

  // ── Demo data: fills every step so you can inspect + test all logic instantly ──
  const loadDemoData = () => {
    setSessionName('Demo Campaign - November Newsletter')
    setSessionColor('#8b5cf6')
    setRecipients(DEMO_RECIPIENTS)
    setCsvMeta({ totalRows: 3, duplicatesRemoved: 0, invalid: 0, detectedEmailColumn: 'email (demo)', detectedNameColumn: 'name (demo)', demo: true })
    setSubject(DEMO_SUBJECT)
    setBodyHtml(DEMO_BODY)
    setFromName('Jane Sender')
    setFromEmail('sender@example.com')
    setProviderType('gmail')
    setSmtpUser('sender@gmail.com')
    setSignatureText('Jane Sender\nFounder, Acme Inc.\n+1 555 0100')
    toast.success('Demo data loaded — every step is now previewable')
  }

  const resetAll = () => {
    setSessionName('')
    setSessionColor('#3b82f6')
    setRecipients([])
    setCsvMeta(null)
    setSubject('')
    setBodyHtml('')
    setSignatureText('')
    setSignatureImage('')
    setAttachments([])
    setFromName('')
    setFromEmail('')
    setProviderType('gmail')
    setSmtpHost('')
    setSmtpPort('587')
    setSmtpSecure(false)
    setSmtpUser('')
    setSmtpPass('')
    setTestResult(null)
    setSelectedProfileId(null)
    setSuggestions([])
    setDraftInfo(null)
    api.clearDraft().catch(() => {})
    setDirection(-1)
    setStep(0)
    toast.info('Wizard cleared')
  }

  const downloadSampleCsv = () => {
    const csv = 'email,name\njane@example.com,Jane Doe\ncarlos@example.com,Carlos Rivera\npriya@example.com,Priya Sharma\n'
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'sample-recipients.csv'
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Sample CSV downloaded')
  }

  // ── CSV handling ──
  const handleCsvFile = useCallback(async (file: File) => {
    if (!file) return
    const isCsv = /\.(csv|txt)$/i.test(file.name) || file.type.includes('csv') || file.type.includes('text')
    if (!isCsv) {
      toast.error('Please upload a .csv file')
      return
    }
    setParsing(true)
    try {
      const data = await api.parseCsv(file)
      setCsvMeta(data)
      setRecipients(data.recipients)
      if (data.recipients.length === 0) {
        toast.error('No valid emails found in the CSV')
      } else {
        toast.success(`Parsed ${data.recipients.length} valid recipient${data.recipients.length === 1 ? '' : 's'}`)
        if (!sessionName) setSessionName(file.name.replace(/\.[^.]+$/, ''))
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to parse CSV')
    } finally {
      setParsing(false)
    }
  }, [sessionName])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleCsvFile(file)
  }

  // ── Signature image ──
  const onSigImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Signature image must be under 2MB')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setSignatureImage(reader.result as string)
      toast.success('Signature image added')
    }
    reader.readAsDataURL(file)
  }

  // ── Attachments ──
  const uploadAttachment = async (file: File) => {
    setUploadingAtt(true)
    try {
      const data = await api.uploadAttachment(file)
      setAttachments((prev) => [...prev, data])
      toast.success(`Attached ${file.name}`)
    } catch (e: any) {
      toast.error(e.message || 'Upload failed')
    } finally {
      setUploadingAtt(false)
    }
  }
  const onAttDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setAttDragOver(false)
    const files = Array.from(e.dataTransfer.files || [])
    files.forEach(uploadAttachment)
  }
  const removeAttachment = async (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.stagingId !== id))
    toast.info('Attachment removed')
  }

  // ── Variable insertion ──
  const insertVar = (varStr: string) => {
    const ta = document.getElementById('body-html') as HTMLTextAreaElement
    if (!ta) {
      setBodyHtml((p) => p + varStr)
      return
    }
    const start = ta.selectionStart ?? bodyHtml.length
    const end = ta.selectionEnd ?? bodyHtml.length
    const next = bodyHtml.slice(0, start) + varStr + bodyHtml.slice(end)
    setBodyHtml(next)
    setTimeout(() => {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = start + varStr.length
    }, 0)
  }
  const wrapSelection = (before: string, after: string) => {
    const ta = document.getElementById('body-html') as HTMLTextAreaElement
    if (!ta) return
    const start = ta.selectionStart ?? 0
    const end = ta.selectionEnd ?? 0
    const sel = bodyHtml.slice(start, end) || 'text'
    const next = bodyHtml.slice(0, start) + before + sel + after + bodyHtml.slice(end)
    setBodyHtml(next)
    setTimeout(() => ta.focus(), 0)
  }
  const insertSubjectVar = (varStr: string) => setSubject((p) => p + varStr)

  // ── Save / load / delete signature + template (every button wired) ──
  const saveSignature = async () => {
    if (!sigName.trim()) return toast.error('Give your signature a name')
    try {
      if (signatureImage) {
        await api.saveSignature({ name: sigName, type: 'image', content: signatureImage })
      } else if (signatureText) {
        await api.saveSignature({ name: sigName, type: 'text', content: signatureText })
      } else {
        return toast.error('Nothing to save — add text or an image first')
      }
      const d = await api.listSignatures()
      setSignatures(d.signatures as Signature[])
      toast.success('Signature saved to library')
      setSaveSigOpen(false)
      setSigName('')
    } catch (e: any) {
      toast.error(e.message)
    }
  }
  const deleteSignature = async (id: string) => {
    try {
      await api.deleteSignature(id)
      setSignatures((prev) => prev.filter((s) => s.id !== id))
      toast.success('Signature deleted')
    } catch (e: any) {
      toast.error(e.message || 'Delete failed')
    }
  }
  const saveTemplate = async () => {
    if (!tplName.trim()) return toast.error('Give your template a name')
    if (!subject || !bodyHtml) return toast.error('Add a subject and body first')
    try {
      await api.saveTemplate({ name: tplName, subject, body: bodyHtml })
      const d = await api.listTemplates()
      setTemplates(d.templates as EmailTemplate[])
      toast.success('Template saved')
      setSaveTplOpen(false)
      setTplName('')
    } catch (e: any) {
      toast.error(e.message)
    }
  }
  const deleteTemplate = async (id: string) => {
    try {
      await api.deleteTemplate(id)
      setTemplates((prev) => prev.filter((t) => t.id !== id))
      toast.success('Template deleted')
    } catch (e: any) {
      toast.error(e.message || 'Delete failed')
    }
  }

  // ── Test SMTP (wired to /api/smtp/test) ──
  const testSmtp = async () => {
    if (!smtpUser || !smtpPass) return toast.error('Enter your email and app password first')
    setTesting(true)
    setTestResult(null)
    try {
      const res = await api.testSmtp({ providerType, smtpUser, smtpPass, smtpHost, smtpPort: Number(smtpPort), smtpSecure })
      setTestResult({ ok: res.ok, message: res.ok ? res.message || 'Connected' : res.error || 'Failed' })
      if (res.ok) {
        toast.success('SMTP connection verified!')
        persistProfile()
      }
      else toast.error('SMTP test failed — see message')
    } catch (e: any) {
      setTestResult({ ok: false, message: e.message })
      toast.error('SMTP test failed')
    } finally {
      setTesting(false)
    }
  }

  // ── Launch ──
  const launch = async () => {
    const missing: string[] = []
    if (recipients.length === 0) missing.push('recipients (Upload CSV)')
    if (!subject.trim()) missing.push('subject (Compose)')
    if (!bodyHtml.trim()) missing.push('email body (Compose)')
    if (!fromEmail.trim()) missing.push('from email (Sender & SMTP)')
    if (!smtpUser.trim() || (!smtpPass && !canSendWithoutTyping)) missing.push('SMTP login (Sender & SMTP)')
    if (providerType === 'smtp' && (!smtpHost.trim() || !smtpPort.trim())) missing.push('custom SMTP host/port')
    if (missing.length > 0) {
      toast.error(`Missing: ${missing.join(', ')}`)
      return
    }
    setLaunching(true)
    try {
      const { session } = await api.createSession({
        name: sessionName || `Campaign ${new Date().toLocaleDateString()}`,
        color: sessionColor,
        fromName: fromName || fromEmail.split('@')[0],
        fromEmail,
        providerType,
        smtpHost: smtpHost || null,
        smtpPort: smtpPort ? Number(smtpPort) : null,
        smtpSecure,
        subject,
        bodyHtml,
        signatureText: signatureText || null,
        signatureImage: signatureImage || null,
        batchSize: Number(batchSize),
        batchDelayMs: Number(batchDelayMs),
        perEmailDelayMs: Number(perEmailDelayMs),
        recipients,
        attachments: attachments.map((a) => ({
          filename: a.filename, filepath: a.filepath, mimetype: a.mimetype, size: a.size,
        })),
      })
      toast.success('Campaign created. Starting send engine…')
      if (smtpUser && smtpPass) {
        await api.startSession(session.id, smtpUser, smtpPass)
        persistProfile()
      } else {
        await api.startSessionWithProfile(session.id, selectedProfileId!)
      }
      // Launch clears the draft — the campaign itself is now the durable record.
      api.clearDraft().catch(() => {})
      api.saveSettings({ lastCampaign: { providerType, batchSize, batchDelayMs, perEmailDelayMs } }).catch(() => {})
      onLaunched(session.id)
    } catch (e: any) {
      toast.error(e.message || 'Failed to launch campaign')
    } finally {
      setLaunching(false)
    }
  }

  const canSendWithoutTyping = !!selectedProfileId && profiles.some((p) => p.id === selectedProfileId && p.hasPassword)

  // Readiness checklist (powers Review tab + nav hints) — never blocks navigation
  const checks = [
    { label: 'Recipients uploaded', done: recipients.length > 0, detail: recipients.length > 0 ? `${recipients.length} valid` : 'Go to Upload CSV', step: 0 },
    { label: 'Subject line', done: subject.trim() !== '', detail: subject || 'Go to Compose', step: 1 },
    { label: 'Email body', done: bodyHtml.trim() !== '', detail: bodyHtml ? `${bodyHtml.length} chars` : 'Go to Compose', step: 1 },
    { label: 'Sender identity', done: fromEmail.trim() !== '', detail: fromEmail || 'Go to Sender & SMTP', step: 3 },
    { label: 'SMTP login', done: smtpUser.trim() !== '' && (smtpPass !== '' || canSendWithoutTyping), detail: smtpUser ? (canSendWithoutTyping && smtpPass === '' ? 'Saved password (no re-typing)' : smtpUser) : 'Go to Sender & SMTP', step: 3 },
    { label: 'Attachments (optional)', done: true, detail: attachments.length > 0 ? `${attachments.length} file(s)` : 'None — optional', step: 2 },
  ]
  const missingCount = checks.filter((c) => !c.done).length

  // Per-step validity — green means "filled in correctly", never "visited".
  // Previewing a step never marks it complete.
  const stepValid = [
    recipients.length > 0,
    subject.trim() !== '' && bodyHtml.trim() !== '',
    attachments.length > 0, // attachments optional — check only when files uploaded
    fromEmail.trim() !== '' && smtpUser.trim() !== '' && (smtpPass !== '' || canSendWithoutTyping) &&
      (providerType !== 'smtp' || (smtpHost.trim() !== '' && smtpPort.trim() !== '')),
    checks.every((c) => c.done || c.label === 'Attachments (optional)'),
  ]
  const stepHint: string[] = [
    stepValid[0] ? 'Complete' : 'Needs a CSV upload',
    stepValid[1] ? 'Complete' : 'Needs subject + body',
    'Optional',
    stepValid[3] ? 'Complete' : 'Needs sender + SMTP login',
    stepValid[4] ? 'Ready to launch' : `${missingCount} item${missingCount === 1 ? '' : 's'} missing`,
  ]

  // Slide direction for the lightweight tab transition
  const [direction, setDirection] = useState(1)
  const goStep = (i: number) => {
    setDirection(i >= step ? 1 : -1)
    setStep(i)
  }

  const samplePreview = (() => {
    const r = recipients[0] || { email: 'jane@example.com', name: 'Jane Doe' }
    const displayName = r.name || r.email.split('@')[0]
    let html = bodyHtml || '<p style="color:#94a3b8">Your email content will appear here. Go to <b>Compose</b> or click <b>Load demo data</b> above to preview instantly.</p>'
    html = html
      .replace(/\{\{name\}\}/g, displayName)
      .replace(/\{\{first_name\}\}/g, displayName.split(' ')[0])
      .replace(/\{\{email\}\}/g, r.email)
    let sig = ''
    if (signatureText) sig += `<div style="margin-top:24px;font-size:14px;color:#475569;white-space:pre-wrap;border-top:1px solid #e2e8f0;padding-top:12px">${signatureText.replace(/</g, '&lt;')}</div>`
    if (signatureImage) sig += `<div style="margin-top:12px"><img src="${signatureImage}" style="max-height:90px;max-width:320px"/></div>`
    return { subject: (subject || '(no subject yet)').replace(/\{\{name\}\}/g, displayName), body: html + sig, recipient: r }
  })()

  const activeProvider = PROVIDERS.find((p) => p.value === providerType)!

  return (
    <div className="max-w-5xl mx-auto">
      {/* Preview-mode banner: every step inspectable without uploading first */}
      <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 flex items-start gap-2 text-xs text-sky-900">
        <Eye className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="flex-1">
          <span className="font-semibold">Preview mode — nothing is locked.</span>{' '}
          Click any step above to inspect every field, button and requirement before uploading anything.
          {missingCount > 0 ? (
            <span> {missingCount} item{missingCount === 1 ? '' : 's'} still needed before launch (see Review).</span>
          ) : (
            <span className="font-medium"> All required fields are filled — ready to launch.</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button variant="outline" size="sm" className="h-7 text-xs bg-white" onClick={loadDemoData}>
            <Sparkles className="h-3.5 w-3.5" /> Load demo data
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={resetAll}>
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </Button>
        </div>
      </div>

      {/* Resume banner — auto-saved progress from a previous session (power cut safe) */}
      {draftInfo && !recovered && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 flex items-start gap-2 text-xs text-blue-900">
          <History className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="font-semibold">Unfinished campaign found — auto-saved {new Date(draftInfo.updatedAt).toLocaleString()}.</span>{' '}
            Recipients, content and settings are all stored. Resume it instead of starting over.
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button size="sm" className="h-7 text-xs bg-brand text-white hover:bg-blue-700" onClick={restoreDraft}>Restore progress</Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-blue-700 hover:text-blue-800" onClick={discardDraft}>Discard</Button>
          </div>
        </div>
      )}

      {/* Stepper — slider tabs: click any step to preview. Green check = filled in, not visited. */}
      <div className="mb-2">
        <div className="flex items-stretch justify-between gap-1" role="tablist" aria-label="Campaign steps">
          {STEPS.map((s, i) => {
            const Icon = s.icon
            const valid = stepValid[i]
            const active = i === step
            return (
              <div key={s.title} className="flex items-stretch flex-1 last:flex-none min-w-0">
                <button
                  role="tab"
                  aria-selected={active}
                  onClick={() => goStep(i)}
                  title={`${s.title} — ${stepHint[i]}. Click to preview.`}
                  className="relative flex flex-1 flex-col items-center gap-1.5 px-1 pt-1 pb-2.5 group cursor-pointer min-w-0"
                >
                  <div
                    className={`h-9 w-9 rounded-full flex items-center justify-center border-2 transition-all duration-200 group-hover:scale-105 ${
                      valid ? 'bg-emerald-600 border-emerald-600 text-white' :
                      active ? 'bg-brand border-brand text-white ring-2 ring-blue-200 scale-105' :
                      'bg-background border-border text-muted-foreground group-hover:border-brand/60'
                    }`}
                  >
                    {valid ? <CheckCircle2 className="h-5 w-5" /> : active ? <Icon className="h-4 w-4" /> : <span className="text-xs font-bold tabular-nums">{i + 1}</span>}
                  </div>
                  <span className={`text-[11px] font-medium hidden sm:block truncate ${active ? 'text-foreground' : 'text-muted-foreground'}`}>{s.title}</span>
                  <span className="text-[10px] text-muted-foreground hidden md:block -mt-1 truncate">{s.hint}</span>
                  {/* sliding active-tab indicator */}
                  <span
                    aria-hidden
                    className={`absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-brand origin-center transition-transform duration-200 ease-out ${active ? 'scale-x-100' : 'scale-x-0'}`}
                  />
                </button>
                {i < STEPS.length - 1 && (
                  <div className="flex items-center px-0.5 pb-6" aria-hidden>
                    <div className={`h-0.5 w-4 sm:w-8 rounded transition-colors duration-200 ${stepValid[i] ? 'bg-emerald-500' : 'bg-border'}`} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <p className="text-center text-[11px] text-muted-foreground mt-1">
          <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-600" /> green check = step complete</span>
          <span className="mx-1.5">·</span> click any step to preview it
        </p>
      </div>

      <div key={step} className={direction >= 0 ? 'mp-step-enter-right' : 'mp-step-enter-left'}>
      <Card>
        <CardContent className="p-6">
          {/* STEP 1: UPLOAD CSV */}
          {step === 0 && (
            <div className="space-y-5">
              <div className="flex items-start justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <DuoTile icon={FileSpreadsheet} size="sm" /> Upload your recipient list
                    <Badge variant="secondary" className="text-[10px]">Required</Badge>
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">Drag &amp; drop or browse for a CSV file. We&apos;ll auto-detect the email and name columns, validate addresses, and remove duplicates. Max 1,000 recipients.</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={downloadSampleCsv}>
                    <Download className="h-3.5 w-3.5" /> Sample CSV
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={loadDemoData}>
                    <Sparkles className="h-3.5 w-3.5" /> Demo data
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground flex items-center gap-1.5"><Info className="h-3.5 w-3.5" /> What this step requires</p>
                <ul className="list-disc pl-5 space-y-0.5">
                  <li>A <code className="bg-muted px-1 rounded">.csv</code> file with a header row containing an <code className="bg-muted px-1 rounded">email</code> column (and optionally a <code className="bg-muted px-1 rounded">name</code> column).</li>
                  <li>Example header: <code className="bg-muted px-1 rounded">email,name</code> — or download the sample CSV above.</li>
                  <li>You can skip ahead and inspect Compose / Attachments / SMTP / Review right now — just click the steps above.</li>
                </ul>
              </div>

              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
                  dragOver ? 'border-brand bg-blue-50/50 scale-[1.01]' : 'border-border hover:border-brand/60 hover:bg-muted/40'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt,text/csv"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCsvFile(f); e.currentTarget.value = '' }}
                />
                <div className="flex flex-col items-center gap-3">
                  <div className="h-14 w-14 rounded-full bg-blue-50 flex items-center justify-center">
                    {parsing ? <Loader2 className="h-7 w-7 text-brand animate-spin" /> : <UploadCloud className="h-7 w-7 text-brand" />}
                  </div>
                  <div>
                    <p className="font-medium">{parsing ? 'Parsing your CSV…' : 'Drop your CSV here, or click to browse'}</p>
                    <p className="text-xs text-muted-foreground mt-1">Supports .csv with headers like email, name</p>
                  </div>
                </div>
              </div>

              {csvMeta && recipients.length > 0 && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Stat label="Valid recipients" value={recipients.length} tone="emerald" />
                    <Stat label="Total rows" value={csvMeta.totalRows} />
                    <Stat label="Duplicates removed" value={csvMeta.duplicatesRemoved ?? 0} tone="amber" />
                    <Stat label="Invalid emails" value={csvMeta.invalid ?? 0} tone="rose" />
                  </div>
                  <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                    <span>Email column: <code className="bg-muted px-1.5 py-0.5 rounded">{csvMeta.detectedEmailColumn}</code></span>
                    {csvMeta.detectedNameColumn && <span>Name column: <code className="bg-muted px-1.5 py-0.5 rounded">{csvMeta.detectedNameColumn}</code></span>}
                  </div>
                  <div className="border rounded-lg overflow-hidden">
                    <div className="bg-muted/60 px-3 py-2 text-xs font-medium text-muted-foreground flex items-center justify-between">
                      <span>Preview · first {Math.min(8, recipients.length)} of {recipients.length}</span>
                      <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => { setRecipients([]); setCsvMeta(null); toast.info('Recipient list removed') }}>Remove list</Button>
                    </div>
                    <div className="max-h-56 overflow-y-auto scroll-thin">
                      <table className="w-full text-sm">
                        <tbody>
                          {recipients.slice(0, 8).map((r, i) => (
                            <tr key={i} className="border-t">
                              <td className="px-3 py-1.5 font-medium">{r.name || <span className="text-muted-foreground italic">—</span>}</td>
                              <td className="px-3 py-1.5 text-muted-foreground">{r.email}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <Label htmlFor="session-name">Campaign name (optional)</Label>
                <Input id="session-name" value={sessionName} onChange={(e) => setSessionName(e.target.value)} placeholder="e.g. November Newsletter" className="mt-1" />
                <p className="text-xs text-muted-foreground mt-1">Shown in history. If blank, the date is used.</p>
              </div>
              <div>
                <Label>Campaign color (for identification)</Label>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {['#3b82f6', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#6366f1'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setSessionColor(c)}
                      className={`h-7 w-7 rounded-full border-2 transition-all ${sessionColor === c ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'}`}
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                  <input
                    type="color"
                    value={sessionColor}
                    onChange={(e) => setSessionColor(e.target.value)}
                    className="h-7 w-7 rounded-full border border-border cursor-pointer"
                    title="Custom color"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">Pick a color to identify this campaign in your history.</p>
              </div>
            </div>
          )}

          {/* STEP 2: COMPOSE */}
          {step === 1 && (
            <div className="space-y-5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <DuoTile icon={PenLine} size="sm" /> Compose your email
                    <Badge variant="secondary" className="text-[10px]">Required</Badge>
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">Write your message. Use variables to personalize per recipient. Everything previews live on the right.</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Select onValueChange={(v) => {
                    const t = templates.find((x) => x.id === v)
                    if (t) { setSubject(t.subject); setBodyHtml(t.body); toast.success(`Loaded template "${t.name}"`) }
                  }}>
                    <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Load template" /></SelectTrigger>
                    <SelectContent>
                      {templates.length === 0 ? <SelectItem value="_none" disabled>No saved templates</SelectItem> :
                        templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setSaveTplOpen(true)}><Save className="h-3.5 w-3.5" /> Save as template</Button>
                </div>
              </div>

              {templates.length > 0 && (
                <div className="flex flex-wrap gap-1.5 items-center text-xs">
                  <span className="text-muted-foreground">Saved templates:</span>
                  {templates.map((t) => (
                    <span key={t.id} className="inline-flex items-center gap-1 border rounded-full pl-2.5 pr-1 py-0.5 bg-muted/40">
                      {t.name}
                      <button
                        className="h-5 w-5 rounded-full hover:bg-rose-100 hover:text-rose-600 flex items-center justify-center"
                        title={`Delete template "${t.name}"`}
                        onClick={() => deleteTemplate(t.id)}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div>
                <Label htmlFor="subject">Subject line <span className="text-rose-500">*</span></Label>
                <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Hi {{name}}, here's your update" className="mt-1" />
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <span className="text-xs text-muted-foreground">Insert into subject:</span>
                  {['{{name}}', '{{first_name}}', '{{email}}'].map((v) => (
                    <Button key={v} variant="outline" size="sm" className="h-6 text-[11px] font-mono" onClick={() => insertSubjectVar(v)}>{v}</Button>
                  ))}
                </div>
              </div>

              <div className="grid lg:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label htmlFor="body-html">Email body (HTML) <span className="text-rose-500">*</span></Label>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" className="h-7 text-xs" title="Bold selection" onClick={() => wrapSelection('<b>', '</b>')}><Bold className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" title="Italic selection" onClick={() => wrapSelection('<i>', '</i>')}><Italic className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" title="Link selection" onClick={() => wrapSelection('<a href="https://">', '</a>')}><Link2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                  <Textarea
                    id="body-html"
                    value={bodyHtml}
                    onChange={(e) => setBodyHtml(e.target.value)}
                    placeholder="<p>Hello {{name}},</p><p>Here is your personalized message…</p>"
                    className="mt-1 font-mono text-xs min-h-[260px]"
                  />
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    <span className="text-xs text-muted-foreground">Insert:</span>
                    {['{{name}}', '{{first_name}}', '{{email}}'].map((v) => (
                      <Button key={v} variant="outline" size="sm" className="h-7 text-xs font-mono" onClick={() => insertVar(v)}>{v}</Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">{bodyHtml.length} characters · variables render per recipient</p>
                </div>
                <div>
                  <Label>Live preview <span className="text-xs text-muted-foreground font-normal">· as {samplePreview.recipient.email}</span></Label>
                  <div className="mt-1 border rounded-lg overflow-hidden bg-white">
                    <div className="px-3 py-2 border-b bg-muted/40 text-xs">
                      <div className="font-medium truncate">Subject: {samplePreview.subject || <span className="text-muted-foreground italic">(no subject)</span>}</div>
                    </div>
                    <div className="p-3 text-sm max-h-[300px] overflow-y-auto scroll-thin" dangerouslySetInnerHTML={{ __html: samplePreview.body }} />
                  </div>
                </div>
              </div>

              {/* Signature */}
              <Separator />
              <div>
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <Label className="flex items-center gap-2"><PenLine className="h-4 w-4" /> Signature <Badge variant="outline" className="text-[10px] font-normal">Optional</Badge></Label>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Select onValueChange={(v) => {
                      const s = signatures.find((x) => x.id === v)
                      if (!s) return
                      if (s.type === 'text') { setSignatureText(s.content); setSignatureImage('') }
                      else { setSignatureImage(s.content); setSignatureText('') }
                      toast.success(`Loaded signature "${s.name}"`)
                    }}>
                      <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Load signature" /></SelectTrigger>
                      <SelectContent>
                        {signatures.length === 0 ? <SelectItem value="_none" disabled>No saved signatures</SelectItem> :
                          signatures.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} ({s.type})</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setSaveSigOpen(true)}><Save className="h-3.5 w-3.5" /> Save signature</Button>
                  </div>
                </div>
                {signatures.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 items-center text-xs mb-3">
                    <span className="text-muted-foreground">Saved:</span>
                    {signatures.map((s) => (
                      <span key={s.id} className="inline-flex items-center gap-1 border rounded-full pl-2.5 pr-1 py-0.5 bg-muted/40">
                        {s.name} ({s.type})
                        <button
                          className="h-5 w-5 rounded-full hover:bg-rose-100 hover:text-rose-600 flex items-center justify-center"
                          title={`Delete signature "${s.name}"`}
                          onClick={() => deleteSignature(s.id)}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="sig-text" className="text-xs">Text signature</Label>
                    <Textarea id="sig-text" value={signatureText} onChange={(e) => setSignatureText(e.target.value)} placeholder={"John Doe\nFounder, Acme Inc.\n+1 555 0100"} className="mt-1 text-xs min-h-[90px]" />
                    {signatureText && (
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-rose-600 mt-1" onClick={() => { setSignatureText(''); toast.info('Text signature cleared') }}>
                        <Trash2 className="h-3.5 w-3.5" /> Clear text
                      </Button>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs">Image signature (handwritten)</Label>
                    <div className="mt-1 border rounded-lg p-3 flex items-center gap-3">
                      {signatureImage ? (
                        <img src={signatureImage} alt="signature" className="max-h-16 max-w-[160px] object-contain" />
                      ) : (
                        <div className="h-16 w-full flex items-center justify-center text-xs text-muted-foreground border border-dashed rounded">No image</div>
                      )}
                      <div className="flex flex-col gap-1">
                        <label className="cursor-pointer">
                          <span className="inline-flex items-center justify-center gap-1.5 text-xs h-8 px-3 rounded-md border bg-background hover:bg-accent"><ImageIcon className="h-3.5 w-3.5" /> Upload</span>
                          <input type="file" accept="image/*" className="hidden" onChange={onSigImage} />
                        </label>
                        {signatureImage && <Button variant="ghost" size="sm" className="h-7 text-xs text-rose-600" onClick={() => { setSignatureImage(''); toast.info('Signature image removed') }}>Remove</Button>}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: ATTACHMENTS */}
          {step === 2 && (
            <div className="space-y-5">
              <div className="flex items-start justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <DuoTile icon={Paperclip} size="sm" /> Attachments
                    <Badge variant="outline" className="text-[10px] font-normal">Optional</Badge>
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">Add files to attach to every email. Up to 25 MB each. Drag &amp; drop or browse.</p>
                </div>
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={loadDemoData}>
                  <Sparkles className="h-3.5 w-3.5" /> Demo data
                </Button>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground flex items-center gap-1.5"><Info className="h-3.5 w-3.5" /> What this step requires</p>
                <ul className="list-disc pl-5 space-y-0.5">
                  <li>Nothing is required — campaigns send fine with zero attachments.</li>
                  <li>Each file is uploaded to the server staging area, then attached to every outgoing email.</li>
                  <li>Use the <b>Remove</b> (×) button on any row to detach before launch.</li>
                </ul>
              </div>
              <div
                onDragOver={(e) => { e.preventDefault(); setAttDragOver(true) }}
                onDragLeave={() => setAttDragOver(false)}
                onDrop={onAttDrop}
                onClick={() => attInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                  attDragOver ? 'border-brand bg-blue-50/50' : 'border-border hover:border-brand/60 hover:bg-muted/40'
                }`}
              >
                <input ref={attInputRef} type="file" multiple className="hidden" onChange={(e) => { Array.from(e.target.files || []).forEach(uploadAttachment); e.currentTarget.value = '' }} />
                <div className="flex flex-col items-center gap-2">
                  {uploadingAtt ? <Loader2 className="h-7 w-7 text-brand animate-spin" /> : <UploadCloud className="h-7 w-7 text-brand" />}
                  <p className="font-medium text-sm">{uploadingAtt ? 'Uploading…' : 'Drop files here or click to browse'}</p>
                  <p className="text-xs text-muted-foreground">Documents, images, PDFs…</p>
                </div>
              </div>
              {attachments.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">{attachments.length} file(s) staged — each will attach to every email</p>
                  {attachments.map((a) => (
                    <div key={a.stagingId} className="flex items-center gap-3 border rounded-lg p-3">
                      <div className="h-9 w-9 rounded bg-muted flex items-center justify-center"><FileText className="h-4 w-4 text-muted-foreground" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{a.filename}</p>
                        <p className="text-xs text-muted-foreground">{formatBytes(a.size)} · {a.mimetype || 'file'}</p>
                      </div>
                      <Button variant="ghost" size="sm" className="h-8 text-rose-600" title={`Remove ${a.filename}`} onClick={() => removeAttachment(a.stagingId)}><X className="h-4 w-4" /></Button>
                    </div>
                  ))}
                </div>
              )}
              {attachments.length === 0 && (
                <p className="text-xs text-muted-foreground text-center">No attachments — this step is optional. You can skip it.</p>
              )}
            </div>
          )}

          {/* STEP 4: SENDER & SMTP */}
          {step === 3 && (
            <div className="space-y-5">
              <div className="flex items-start justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <DuoTile icon={ShieldCheck} size="sm" /> Sender &amp; SMTP configuration
                    <Badge variant="secondary" className="text-[10px]">Required</Badge>
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">Choose your provider and paste your app password. With <b>Remember</b> enabled, the password is stored encrypted on this machine so you never re-type it.</p>
                </div>
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={loadDemoData}>
                  <Sparkles className="h-3.5 w-3.5" /> Fill demo sender
                </Button>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground flex items-center gap-1.5"><Info className="h-3.5 w-3.5" /> What this step requires</p>
                <ul className="list-disc pl-5 space-y-0.5">
                  <li><b>From name + From email</b> — what recipients see in their inbox.</li>
                  <li><b>Provider</b> — pick by logo below; host/port auto-fill (Custom SMTP needs host + port).</li>
                  <li><b>SMTP username + app password</b> — never your normal login; use the help link for your provider.</li>
                  <li><b>Remember</b> — tick the box after entering your password to store it encrypted, so future sessions fill everything automatically.</li>
                  <li><b>Test connection</b> — verifies before you launch. Throttling is optional but recommended.</li>
                </ul>
              </div>

              {/* Saved identities — one click re-fills sender + provider + password */}
              {profiles.length > 0 && (
                <div className="rounded-lg border p-3">
                  <p className="text-xs font-medium text-foreground flex items-center gap-1.5 mb-2">
                    <History className="h-3.5 w-3.5 text-brand" /> Saved identities — click to fill
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {profiles.map((p) => (
                      <span key={p.id} className={`inline-flex items-center rounded-full border text-xs ${selectedProfileId === p.id ? 'border-brand bg-blue-50 text-blue-900' : 'border-border bg-background text-foreground'}`}>
                        <button onClick={() => useProfile(p)} className="px-3 py-1.5 flex items-center gap-1.5" title={p.hasPassword ? 'Fills sender, provider and the remembered password' : 'Fills sender and provider (password not saved)'}>
                          <ProviderLogo provider={PROVIDERS.find((x) => x.value === p.providerType) || activeProvider} size={14} />
                          {p.fromEmail || p.smtpUser}
                          {p.hasPassword && <CheckCircle2 className="h-3 w-3 text-emerald-600" />}
                        </button>
                        <button onClick={() => removeProfile(p.id)} title="Forget this identity" className="pr-2.5 py-1.5 text-muted-foreground hover:text-rose-600 cursor-pointer">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="from-name">From name <span className="text-rose-500">*</span></Label>
                  <Input id="from-name" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="John Doe" className="mt-1" />
                  <p className="text-xs text-muted-foreground mt-1">Display name in the inbox.</p>
                </div>
                <div>
                  <Label htmlFor="from-email">From email <span className="text-rose-500">*</span></Label>
                  <Input id="from-email" type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="john@gmail.com" className="mt-1" />
                  <p className="text-xs text-muted-foreground mt-1">Must match your SMTP account.</p>
                </div>
              </div>

              <div>
                <Label>Provider <span className="text-rose-500">*</span> <span className="text-xs text-muted-foreground font-normal">· logos load from a public logo API</span></Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1">
                  {PROVIDERS.map((p) => (
                    <button
                      key={p.value}
                      onClick={() => { setProviderType(p.value); setTestResult(null) }}
                      title={`${p.label} — ${p.hint}`}
                      className={`text-left p-3 rounded-lg border-2 transition-all flex items-start gap-2.5 ${
                        providerType === p.value ? 'border-brand bg-blue-50/50 ring-1 ring-brand/30' : 'border-border hover:border-brand/40'
                      }`}
                    >
                      <ProviderLogo provider={p} size={26} />
                      <span className="min-w-0">
                        <span className="text-sm font-medium flex items-center gap-1.5">
                          {p.label}
                          {providerType === p.value && <CheckCircle2 className="h-3.5 w-3.5 text-brand" />}
                        </span>
                        <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight block">{p.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
                  <ProviderLogo provider={activeProvider} size={16} />
                  Selected: <b>{activeProvider.label}</b> — {activeProvider.hint}
                </p>
              </div>

              {providerType === 'smtp' && (
                <div className="grid sm:grid-cols-3 gap-3 p-3 border rounded-lg bg-muted/30">
                  <div>
                    <Label htmlFor="smtp-host" className="text-xs">SMTP host <span className="text-rose-500">*</span></Label>
                    <Input id="smtp-host" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.example.com" className="mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="smtp-port" className="text-xs">Port <span className="text-rose-500">*</span></Label>
                    <Input id="smtp-port" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} placeholder="587" className="mt-1" />
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 text-sm cursor-pointer h-10">
                      <input type="checkbox" checked={smtpSecure} onChange={(e) => setSmtpSecure(e.target.checked)} className="h-4 w-4 rounded" />
                      Use SSL/TLS (port 465)
                    </label>
                  </div>
                </div>
              )}
              {providerType !== 'smtp' && (
                <div className="text-xs text-muted-foreground border rounded-lg px-3 py-2 bg-muted/30">
                  Using preset <b>{activeProvider.label}</b>: host <code className="bg-muted px-1 rounded">{smtpHost || '—'}</code> port <code className="bg-muted px-1 rounded">{smtpPort}</code> {smtpSecure ? '(SSL)' : '(STARTTLS)'}. Pick <b>Custom SMTP</b> to edit these.
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="smtp-user">Email / SMTP username <span className="text-rose-500">*</span></Label>
                  <Input id="smtp-user" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} placeholder="john@gmail.com" className="mt-1" autoComplete="username" />
                </div>
                <div>
                  <Label htmlFor="smtp-pass">App password <span className="text-rose-500">*</span></Label>
                  <Input id="smtp-pass" type="password" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} placeholder={canSendWithoutTyping ? 'Saved — leave empty to send with it' : 'Paste your app password'} className="mt-1" autoComplete="current-password" />
                </div>
              </div>

              <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer select-none" title="Stored encrypted (AES-256-GCM) on this computer only — never sent anywhere else">
                <input type="checkbox" checked={rememberPass} onChange={(e) => setRememberPass(e.target.checked)} className="h-4 w-4 mt-0.5 rounded cursor-pointer" />
                <span>
                  <b className="text-foreground">Remember this app password</b> — encrypted on this computer only, so
                  you never have to re-type it and future campaigns fill themselves in automatically.
                  {selectedProfileId && profiles.some((p) => p.id === selectedProfileId && p.hasPassword) && (
                    <span className="block mt-0.5 text-emerald-600 font-medium">✓ A password is already remembered for {smtpUser || 'this identity'} — you can send without typing it.</span>
                  )}
                </span>
              </label>

              <div className="flex items-center gap-3 flex-wrap">
                <Button variant="outline" onClick={testSmtp} disabled={testing || !smtpUser || !smtpPass}>
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Test connection
                </Button>
                {testResult && (
                  <span className={`inline-flex items-center gap-1.5 text-sm ${testResult.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {testResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                    {testResult.message}
                  </span>
                )}
                {activeProvider.helpUrl && (
                  <a href={activeProvider.helpUrl} target="_blank" rel="noreferrer" className="text-xs text-brand underline ml-auto">
                    {activeProvider.helpLabel}
                  </a>
                )}
              </div>

              <Separator />
              <div>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <Settings2 className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-medium">Throttling &amp; batching</h3>
                  <Badge variant="outline" className="text-[10px] font-normal">Optional</Badge>
                  <div className="ml-auto flex gap-1.5">
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setBatchSize('5'); setBatchDelayMs('5000'); setPerEmailDelayMs('1000'); toast.success('Safe preset applied') }}>Safe</Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setBatchSize('10'); setBatchDelayMs('2000'); setPerEmailDelayMs('500'); toast.success('Balanced preset applied') }}>Balanced</Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setBatchSize('25'); setBatchDelayMs('1000'); setPerEmailDelayMs('200'); toast.success('Fast preset applied') }}>Fast</Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mb-3">Control the send rate to avoid provider limits. Gmail allows ~500/day; keep batches small with pauses.</p>
                <div className="grid sm:grid-cols-3 gap-3">
                  <div>
                    <Label htmlFor="batch-size" className="text-xs">Batch size</Label>
                    <Input id="batch-size" type="number" min={1} max={100} value={batchSize} onChange={(e) => setBatchSize(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="batch-delay" className="text-xs">Pause between batches (ms)</Label>
                    <Input id="batch-delay" type="number" min={0} value={batchDelayMs} onChange={(e) => setBatchDelayMs(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="per-email" className="text-xs">Delay per email (ms)</Label>
                    <Input id="per-email" type="number" min={0} value={perEmailDelayMs} onChange={(e) => setPerEmailDelayMs(e.target.value)} className="mt-1" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: REVIEW & LAUNCH */}
          {step === 4 && (
            <div className="space-y-5">
              <div className="flex items-start justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-lg font-semibold flex items-center gap-2"><DuoTile icon={Send} size="sm" /> Review &amp; launch</h2>
                  <p className="text-sm text-muted-foreground mt-1">Confirm everything looks right, then launch. You&apos;ll see live logs and per-recipient status immediately.</p>
                </div>
                {missingCount === 0 ? (
                  <Badge className="bg-emerald-600 text-white">Ready to launch</Badge>
                ) : (
                  <Badge variant="secondary">{missingCount} item{missingCount === 1 ? '' : 's'} missing</Badge>
                )}
              </div>

              {/* Smart suggestions — local engine, uses your data + provider limits */}
              {suggestions.length > 0 && suggestionsOpen && (
                <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <DuoTile icon={Sparkles} size="sm" />
                    <h3 className="text-sm font-semibold">Smart suggestions</h3>
                    <Badge variant="outline" className="text-[10px] font-normal">runs on your machine</Badge>
                    <button className="ml-auto text-muted-foreground hover:text-foreground cursor-pointer" onClick={() => setSuggestionsOpen(false)} title="Hide suggestions" aria-label="Hide suggestions">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="space-y-2">
                    {suggestions.map((s) => (
                      <div key={s.id} className="flex items-start gap-3 rounded-lg border border-blue-100 bg-white p-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{s.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{s.detail}</p>
                        </div>
                        {s.apply && (
                          <Button size="sm" variant="outline" className="h-7 text-xs shrink-0 bg-white" onClick={() => applySuggestion(s)}>Apply</Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Readiness checklist — each row jumps to its step */}
              <div className="space-y-2">
                {checks.map((c) => (
                  <button
                    key={c.label}
                    onClick={() => goStep(c.step)}
                    title={`Go to step ${c.step + 1}`}
                    className={`w-full flex items-center gap-3 border rounded-lg p-3 text-left transition-colors hover:border-brand/50 ${
                      c.done ? 'border-emerald-200 bg-emerald-50/40' : 'border-amber-200 bg-amber-50/40'
                    }`}
                  >
                    {c.done ? <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" /> : <CircleAlert className="h-4 w-4 text-amber-600 shrink-0" />}
                    <span className="flex-1 min-w-0">
                      <span className="text-sm font-medium block">{c.label}</span>
                      <span className="text-xs text-muted-foreground truncate block">{c.detail}</span>
                    </span>
                    <span className="text-xs text-brand underline shrink-0">Review →</span>
                  </button>
                ))}
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <ReviewItem icon={FileSpreadsheet} label="Recipients" value={`${recipients.length} valid`} />
                <ReviewItem icon={Mail} label="Sender" value={fromEmail ? `${fromName || fromEmail.split('@')[0]} <${fromEmail}>` : '— (add in Sender & SMTP)'} />
                <div className="flex items-center gap-3 border rounded-lg p-3">
                  <div className="h-8 w-8 rounded bg-muted flex items-center justify-center shrink-0">
                    <ProviderLogo provider={activeProvider} size={20} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Provider</p>
                    <p className="text-sm font-medium truncate">{activeProvider.label} · {smtpHost}:{smtpPort}</p>
                  </div>
                </div>
                <ReviewItem icon={User} label="SMTP user" value={smtpUser || '—'} />
                <ReviewItem icon={PenLine} label="Subject" value={subject || '—'} />
                <ReviewItem icon={Paperclip} label="Attachments" value={`${attachments.length} file(s)`} />
                <ReviewItem icon={Settings2} label="Throttle" value={`${batchSize}/batch · ${batchDelayMs}ms pause · ${perEmailDelayMs}ms/email`} />
                <ReviewItem icon={PenLine} label="Signature" value={signatureText ? 'Text' : signatureImage ? 'Image' : 'None'} />
              </div>
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-muted/60 px-3 py-2 text-xs font-medium">Email preview</div>
                <div className="p-3 text-sm max-h-52 overflow-y-auto scroll-thin bg-white" dangerouslySetInnerHTML={{ __html: samplePreview.body }} />
              </div>
              {attachments.length > 0 && (
                <div className="text-xs text-muted-foreground border rounded-lg p-3">
                  <span className="font-medium">Staged attachments:</span> {attachments.map((a) => a.filename).join(', ')}
                </div>
              )}
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 flex items-start gap-2 text-xs text-amber-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>By launching, emails will be sent via your SMTP account. Make sure you have permission to email these recipients and respect anti-spam laws (CAN-SPAM/GDPR). The sandbox may block outbound SMTP — if so, failures will be logged clearly so you can run this on a server with SMTP access.</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      </div>

      {/* Nav buttons — never locked: you can always move between steps */}
      <div className="flex items-center justify-between mt-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => { resetAll(); onCancel() }}>Cancel</Button>
          <Button variant="ghost" size="sm" className="text-xs" onClick={resetAll}>
            <RotateCcw className="h-3.5 w-3.5" /> Start over
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {step > 0 && (
            <Button variant="outline" onClick={() => goStep(step - 1)}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button onClick={() => goStep(step + 1)} className="bg-brand text-white hover:bg-blue-700">
              Next: {STEPS[step + 1].title} <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={launch} disabled={launching} className="bg-brand text-white hover:bg-blue-700">
              {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {launching ? 'Launching…' : `Create & Send to ${recipients.length || '—'}`}
            </Button>
          )}
        </div>
      </div>
      <p className="text-center text-xs text-muted-foreground mt-2">
        Free navigation is on — use Back / Next or click any step. Launch validates {checks.filter((c) => !c.done && c.label !== 'Attachments (optional)').length === 0 ? 'successfully ✓' : 'and will list exactly what is missing'}.
      </p>

      {/* Save signature dialog */}
      <Dialog open={saveSigOpen} onOpenChange={setSaveSigOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save signature to library</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Save your current {signatureImage ? 'image' : 'text'} signature so you can reuse it in future campaigns.</p>
            <Input value={sigName} onChange={(e) => setSigName(e.target.value)} placeholder="Signature name (e.g. Work signature)" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveSigOpen(false)}>Cancel</Button>
            <Button onClick={saveSignature} className="bg-brand text-white hover:bg-blue-700">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save template dialog */}
      <Dialog open={saveTplOpen} onOpenChange={setSaveTplOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save email as template</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Current subject: <b>{subject || '(none)'}</b></p>
            <Input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="Template name" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveTplOpen(false)}>Cancel</Button>
            <Button onClick={saveTemplate} className="bg-brand text-white hover:bg-blue-700">Save template</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'emerald' | 'amber' | 'rose' }) {
  const toneClass = tone === 'emerald' ? 'text-emerald-700 bg-emerald-50' : tone === 'amber' ? 'text-amber-700 bg-amber-50' : tone === 'rose' ? 'text-rose-700 bg-rose-50' : 'text-foreground bg-muted'
  return (
    <div className={`rounded-lg p-3 ${toneClass}`}>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs opacity-80">{label}</p>
    </div>
  )
}

function ReviewItem({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 border rounded-lg p-3">
      <div className="h-8 w-8 rounded bg-muted flex items-center justify-center shrink-0"><Icon className="h-4 w-4 text-muted-foreground" /></div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium truncate">{value}</p>
      </div>
    </div>
  )
}

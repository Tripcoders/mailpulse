'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  UploadCloud, FileSpreadsheet, ArrowRight, ArrowLeft, Send, Paperclip, X,
  Mail, PenLine, Image as ImageIcon, CheckCircle2, AlertTriangle, Loader2,
  Save, FileText, ShieldCheck, Zap, Settings2, User, Link2, Bold, Italic,
} from 'lucide-react'
import { api } from '@/lib/api'
import { formatBytes } from './helpers'
import type { Recipient, StagedAttachment, Signature, EmailTemplate, ProviderType } from '@/lib/types'

interface WizardProps {
  onLaunched: (sessionId: string) => void
  onCancel: () => void
}

const STEPS = [
  { title: 'Upload CSV', icon: UploadCloud },
  { title: 'Compose', icon: PenLine },
  { title: 'Attachments', icon: Paperclip },
  { title: 'Sender & SMTP', icon: ShieldCheck },
  { title: 'Review & Launch', icon: Send },
]

const PROVIDERS: { value: ProviderType; label: string; hint: string }[] = [
  { value: 'gmail', label: 'Gmail', hint: 'smtp.gmail.com · port 465 (SSL)' },
  { value: 'yahoo', label: 'Yahoo Mail', hint: 'smtp.mail.yahoo.com · port 465 (SSL)' },
  { value: 'outlook', label: 'Outlook / Office 365', hint: 'smtp.office365.com · port 587 (STARTTLS)' },
  { value: 'smtp', label: 'Custom SMTP', hint: 'Any provider — enter host & port' },
]

export function Wizard({ onLaunched, onCancel }: WizardProps) {
  const [step, setStep] = useState(0)
  const [sessionName, setSessionName] = useState('')

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

  // Load signatures + templates on mount
  useEffect(() => {
    api.listSignatures().then((d) => setSignatures(d.signatures as Signature[])).catch(() => {})
    api.listTemplates().then((d) => setTemplates(d.templates as EmailTemplate[])).catch(() => {})
  }, [])

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
    reader.onload = () => setSignatureImage(reader.result as string)
    reader.readAsDataURL(file)
  }

  // ── Attachments ──
  const uploadAttachment = async (file: File) => {
    try {
      const data = await api.uploadAttachment(file)
      setAttachments((prev) => [...prev, data])
      toast.success(`Attached ${file.name}`)
    } catch (e: any) {
      toast.error(e.message || 'Upload failed')
    }
  }
  const onAttDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setAttDragOver(false)
    const files = Array.from(e.dataTransfer.files || [])
    files.forEach(uploadAttachment)
  }
  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.stagingId !== id))
  }

  // ── Variable insertion ──
  const insertVar = (varStr: string) => {
    const ta = document.getElementById('body-html') as HTMLTextAreaElement
    if (!ta) {
      setBodyHtml((p) => p + varStr)
      return
    }
    const start = ta.selectionStart
    const end = ta.selectionEnd
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
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const sel = bodyHtml.slice(start, end) || 'text'
    const next = bodyHtml.slice(0, start) + before + sel + after + bodyHtml.slice(end)
    setBodyHtml(next)
  }

  // ── Save signature/template ──
  const saveSignature = async () => {
    if (!sigName.trim()) return toast.error('Give your signature a name')
    try {
      if (signatureImage) {
        await api.saveSignature({ name: sigName, type: 'image', content: signatureImage })
      } else if (signatureText) {
        await api.saveSignature({ name: sigName, type: 'text', content: signatureText })
      } else {
        return toast.error('Nothing to save')
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

  // ── Test SMTP ──
  const testSmtp = async () => {
    if (!smtpUser || !smtpPass) return toast.error('Enter your email and app password first')
    setTesting(true)
    setTestResult(null)
    try {
      const res = await api.testSmtp({ providerType, smtpUser, smtpPass, smtpHost, smtpPort: Number(smtpPort), smtpSecure })
      setTestResult({ ok: res.ok, message: res.ok ? res.message || 'OK' : res.error || 'Failed' })
      if (res.ok) toast.success('SMTP connection verified!')
      else toast.error('SMTP test failed')
    } catch (e: any) {
      setTestResult({ ok: false, message: e.message })
      toast.error('SMTP test failed')
    } finally {
      setTesting(false)
    }
  }

  // ── Launch ──
  const launch = async () => {
    if (!fromEmail || !subject || !bodyHtml || recipients.length === 0) {
      return toast.error('Missing required fields')
    }
    if (!smtpUser || !smtpPass) return toast.error('SMTP credentials required')
    setLaunching(true)
    try {
      const { session } = await api.createSession({
        name: sessionName || `Campaign ${new Date().toLocaleDateString()}`,
        fromName: fromName || fromEmail.split('@')[0],
        fromEmail,
        providerType,
        smtpHost: providerType === 'smtp' ? smtpHost : null,
        smtpPort: providerType === 'smtp' ? Number(smtpPort) : null,
        smtpSecure: providerType === 'smtp' ? smtpSecure : null,
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
      await api.startSession(session.id, smtpUser, smtpPass)
      onLaunched(session.id)
    } catch (e: any) {
      toast.error(e.message || 'Failed to launch campaign')
    } finally {
      setLaunching(false)
    }
  }

  const canNext = () => {
    if (step === 0) return recipients.length > 0
    if (step === 1) return subject.trim() !== '' && bodyHtml.trim() !== ''
    if (step === 3) return fromEmail.trim() !== '' && smtpUser.trim() !== '' && smtpPass.trim() !== '' && (providerType !== 'smtp' || (smtpHost.trim() && smtpPort.trim()))
    return true
  }

  const samplePreview = (() => {
    const r = recipients[0] || { email: 'jane@example.com', name: 'Jane Doe' }
    let html = bodyHtml || '<p>Your email content will appear here.</p>'
    html = html
      .replace(/\{\{name\}\}/g, r.name || r.email.split('@')[0])
      .replace(/\{\{first_name\}\}/g, (r.name || r.email.split('@')[0]).split(' ')[0])
      .replace(/\{\{email\}\}/g, r.email)
    let sig = ''
    if (signatureText) sig += `<div style="margin-top:24px;font-size:14px;color:#475569;white-space:pre-wrap;border-top:1px solid #e2e8f0;padding-top:12px">${signatureText.replace(/</g, '&lt;')}</div>`
    if (signatureImage) sig += `<div style="margin-top:12px"><img src="${signatureImage}" style="max-height:90px;max-width:320px"/></div>`
    return { subject: subject.replace(/\{\{name\}\}/g, r.name || 'Jane'), body: html + sig, recipient: r }
  })()

  return (
    <div className="max-w-5xl mx-auto">
      {/* Stepper */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          {STEPS.map((s, i) => {
            const Icon = s.icon
            const done = i < step
            const active = i === step
            return (
              <div key={s.title} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center gap-1.5">
                  <div
                    className={`h-9 w-9 rounded-full flex items-center justify-center border-2 transition-all ${
                      active ? 'bg-brand border-brand text-white' :
                      done ? 'bg-emerald-600 border-emerald-600 text-white' :
                      'bg-background border-border text-muted-foreground'
                    }`}
                  >
                    {done ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-4 w-4" />}
                  </div>
                  <span className={`text-[11px] font-medium hidden sm:block ${active ? 'text-foreground' : 'text-muted-foreground'}`}>{s.title}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-2 rounded ${done ? 'bg-emerald-500' : 'bg-border'}`} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      <Card>
        <CardContent className="p-6">
          {/* STEP 1: UPLOAD CSV */}
          {step === 0 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-brand" /> Upload your recipient list</h2>
                <p className="text-sm text-muted-foreground mt-1">Drag & drop or browse for a CSV file. We&apos;ll auto-detect the email and name columns, validate addresses, and remove duplicates. Max 1,000 recipients.</p>
              </div>

              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
                  dragOver ? 'border-brand bg-emerald-50/50 scale-[1.01]' : 'border-border hover:border-brand/60 hover:bg-muted/40'
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
                  <div className="h-14 w-14 rounded-full bg-emerald-50 flex items-center justify-center">
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
                    <Stat label="Duplicates removed" value={csvMeta.duplicatesRemoved} tone="amber" />
                    <Stat label="Invalid emails" value={csvMeta.invalid} tone="rose" />
                  </div>
                  <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                    <span>Email column: <code className="bg-muted px-1.5 py-0.5 rounded">{csvMeta.detectedEmailColumn}</code></span>
                    {csvMeta.detectedNameColumn && <span>Name column: <code className="bg-muted px-1.5 py-0.5 rounded">{csvMeta.detectedNameColumn}</code></span>}
                  </div>
                  <div className="border rounded-lg overflow-hidden">
                    <div className="bg-muted/60 px-3 py-2 text-xs font-medium text-muted-foreground flex items-center justify-between">
                      <span>Preview · first {Math.min(8, recipients.length)} of {recipients.length}</span>
                      <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => { setRecipients([]); setCsvMeta(null) }}>Remove list</Button>
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
              </div>
            </div>
          )}

          {/* STEP 2: COMPOSE */}
          {step === 1 && (
            <div className="space-y-5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-lg font-semibold flex items-center gap-2"><PenLine className="h-5 w-5 text-brand" /> Compose your email</h2>
                  <p className="text-sm text-muted-foreground mt-1">Write your message. Use variables to personalize per recipient.</p>
                </div>
                <div className="flex items-center gap-2">
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

              <div>
                <Label htmlFor="subject">Subject line</Label>
                <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Hi {{name}}, here&apos;s your update" className="mt-1" />
              </div>

              <div className="grid lg:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label htmlFor="body-html">Email body (HTML)</Label>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => wrapSelection('<b>', '</b>')}><Bold className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => wrapSelection('<i>', '</i>')}><Italic className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => wrapSelection('<a href="https://">', '</a>')}><Link2 className="h-3.5 w-3.5" /></Button>
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
                  <Label className="flex items-center gap-2"><PenLine className="h-4 w-4" /> Signature</Label>
                  <div className="flex items-center gap-2">
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
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="sig-text" className="text-xs">Text signature</Label>
                    <Textarea id="sig-text" value={signatureText} onChange={(e) => setSignatureText(e.target.value)} placeholder={"John Doe\nFounder, Acme Inc.\n+1 555 0100"} className="mt-1 text-xs min-h-[90px]" />
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
                        {signatureImage && <Button variant="ghost" size="sm" className="h-7 text-xs text-rose-600" onClick={() => setSignatureImage('')}>Remove</Button>}
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
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2"><Paperclip className="h-5 w-5 text-brand" /> Attachments</h2>
                <p className="text-sm text-muted-foreground mt-1">Add files to attach to every email. Up to 25 MB each. Drag & drop or browse.</p>
              </div>
              <div
                onDragOver={(e) => { e.preventDefault(); setAttDragOver(true) }}
                onDragLeave={() => setAttDragOver(false)}
                onDrop={onAttDrop}
                onClick={() => attInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                  attDragOver ? 'border-brand bg-emerald-50/50' : 'border-border hover:border-brand/60 hover:bg-muted/40'
                }`}
              >
                <input ref={attInputRef} type="file" multiple className="hidden" onChange={(e) => { Array.from(e.target.files || []).forEach(uploadAttachment); e.currentTarget.value = '' }} />
                <div className="flex flex-col items-center gap-2">
                  <UploadCloud className="h-7 w-7 text-brand" />
                  <p className="font-medium text-sm">Drop files here or click to browse</p>
                  <p className="text-xs text-muted-foreground">Documents, images, PDFs…</p>
                </div>
              </div>
              {attachments.length > 0 && (
                <div className="space-y-2">
                  {attachments.map((a) => (
                    <div key={a.stagingId} className="flex items-center gap-3 border rounded-lg p-3">
                      <div className="h-9 w-9 rounded bg-muted flex items-center justify-center"><FileText className="h-4 w-4 text-muted-foreground" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{a.filename}</p>
                        <p className="text-xs text-muted-foreground">{formatBytes(a.size)} · {a.mimetype || 'file'}</p>
                      </div>
                      <Button variant="ghost" size="sm" className="h-8 text-rose-600" onClick={() => removeAttachment(a.stagingId)}><X className="h-4 w-4" /></Button>
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
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-brand" /> Sender & SMTP configuration</h2>
                <p className="text-sm text-muted-foreground mt-1">Choose your provider and paste your app password. Credentials are kept in memory only and never stored.</p>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="from-name">From name</Label>
                  <Input id="from-name" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="John Doe" className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="from-email">From email</Label>
                  <Input id="from-email" type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="john@gmail.com" className="mt-1" />
                </div>
              </div>

              <div>
                <Label>Provider</Label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
                  {PROVIDERS.map((p) => (
                    <button
                      key={p.value}
                      onClick={() => setProviderType(p.value)}
                      className={`text-left p-3 rounded-lg border-2 transition-all ${
                        providerType === p.value ? 'border-brand bg-emerald-50/50' : 'border-border hover:border-brand/40'
                      }`}
                    >
                      <p className="text-sm font-medium">{p.label}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{p.hint}</p>
                    </button>
                  ))}
                </div>
              </div>

              {providerType === 'smtp' && (
                <div className="grid sm:grid-cols-3 gap-3 p-3 border rounded-lg bg-muted/30">
                  <div>
                    <Label htmlFor="smtp-host" className="text-xs">SMTP host</Label>
                    <Input id="smtp-host" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.example.com" className="mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="smtp-port" className="text-xs">Port</Label>
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

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="smtp-user">Email / SMTP username</Label>
                  <Input id="smtp-user" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} placeholder="john@gmail.com" className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="smtp-pass">App password</Label>
                  <Input id="smtp-pass" type="password" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} placeholder="Paste your app password" className="mt-1" />
                </div>
              </div>

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
                {providerType === 'gmail' && (
                  <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="text-xs text-brand underline ml-auto">
                    How to get a Gmail app password →
                  </a>
                )}
              </div>

              <Separator />
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Settings2 className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-medium">Throttling & batching</h3>
                </div>
                <p className="text-xs text-muted-foreground mb-3">Control the send rate to avoid provider limits. Gmail allows ~500/day; keep batches small with pauses.</p>
                <div className="grid sm:grid-cols-3 gap-3">
                  <div>
                    <Label htmlFor="batch-size" className="text-xs">Batch size</Label>
                    <Input id="batch-size" type="number" value={batchSize} onChange={(e) => setBatchSize(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="batch-delay" className="text-xs">Pause between batches (ms)</Label>
                    <Input id="batch-delay" type="number" value={batchDelayMs} onChange={(e) => setBatchDelayMs(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="per-email" className="text-xs">Delay per email (ms)</Label>
                    <Input id="per-email" type="number" value={perEmailDelayMs} onChange={(e) => setPerEmailDelayMs(e.target.value)} className="mt-1" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: REVIEW & LAUNCH */}
          {step === 4 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2"><Send className="h-5 w-5 text-brand" /> Review & launch</h2>
                <p className="text-sm text-muted-foreground mt-1">Confirm everything looks right, then launch. You&apos;ll see live logs and per-recipient status immediately.</p>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <ReviewItem icon={FileSpreadsheet} label="Recipients" value={`${recipients.length} valid`} />
                <ReviewItem icon={Mail} label="Sender" value={`${fromName || fromEmail.split('@')[0]} <${fromEmail}>`} />
                <ReviewItem icon={ShieldCheck} label="Provider" value={PROVIDERS.find((p) => p.value === providerType)?.label || providerType} />
                <ReviewItem icon={User} label="SMTP user" value={smtpUser} />
                <ReviewItem icon={PenLine} label="Subject" value={subject || '—'} />
                <ReviewItem icon={Paperclip} label="Attachments" value={`${attachments.length} file(s)`} />
                <ReviewItem icon={Settings2} label="Throttle" value={`${batchSize}/batch · ${batchDelayMs}ms pause · ${perEmailDelayMs}ms/email`} />
                <ReviewItem icon={PenLine} label="Signature" value={signatureText ? 'Text' : signatureImage ? 'Image' : 'None'} />
              </div>
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-muted/60 px-3 py-2 text-xs font-medium">Email preview</div>
                <div className="p-3 text-sm max-h-52 overflow-y-auto scroll-thin" dangerouslySetInnerHTML={{ __html: samplePreview.body }} />
              </div>
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 flex items-start gap-2 text-xs text-amber-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>By launching, emails will be sent via your SMTP account. Make sure you have permission to email these recipients and respect anti-spam laws (CAN-SPAM/GDPR). The sandbox may block outbound SMTP — if so, failures will be logged clearly so you can run this on a server with SMTP access.</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Nav buttons */}
      <div className="flex items-center justify-between mt-4">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <div className="flex items-center gap-2">
          {step > 0 && (
            <Button variant="outline" onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext()} className="bg-brand text-white hover:bg-emerald-700">
              Next <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={launch} disabled={launching} className="bg-brand text-white hover:bg-emerald-700">
              {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {launching ? 'Launching…' : 'Create & Send'}
            </Button>
          )}
        </div>
      </div>

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
            <Button onClick={saveSignature} className="bg-brand text-white hover:bg-emerald-700">Save</Button>
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
            <Input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="Template name" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveTplOpen(false)}>Cancel</Button>
            <Button onClick={saveTemplate} className="bg-brand text-white hover:bg-emerald-700">Save template</Button>
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

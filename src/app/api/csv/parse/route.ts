import { NextRequest, NextResponse } from 'next/server'
import Papa from 'papaparse'

export const runtime = 'nodejs'

// POST /api/csv/parse
// Accepts a CSV file upload (FormData field "file") and returns parsed recipients.
// Auto-detects columns: looks for an email column and a name column.
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file')
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    const text = await file.text()
    if (!text.trim()) {
      return NextResponse.json({ error: 'CSV file is empty' }, { status: 400 })
    }

    const result = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
    })

    const rows = (result.data as Record<string, string>[]).filter((r) => r && Object.keys(r).length > 0)
    if (rows.length === 0) {
      return NextResponse.json({ error: 'No data rows found in CSV' }, { status: 400 })
    }

    const headers = result.meta.fields || Object.keys(rows[0])

    // Detect email column
    const emailKey = headers.find((h) => /e[\s_-]?mail|emailaddr|email_address/.test(h)) || headers.find((h) => h === 'email')
    const nameKey = headers.find((h) => /^(name|full[\s_-]?name|recipient|contact|customer|to)$/.test(h)) || headers.find((h) => h === 'name' || h.includes('name'))

    if (!emailKey) {
      // fallback: scan first row for a value that looks like an email
      const anyEmailKey = headers.find((h) => rows.some((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r[h] || '')))
      if (!anyEmailKey) {
        return NextResponse.json({
          error: 'Could not find an email column. Please ensure your CSV has an "email" column.',
          headers,
          sample: rows.slice(0, 3),
        }, { status: 400 })
      }
      const recipients = rows
        .map((r) => ({ email: (r[anyEmailKey] || '').trim(), name: (nameKey ? r[nameKey] : (r['name'] || '') || '').trim() }))
        .filter((r) => r.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email))
      return NextResponse.json({ recipients, totalRows: rows.length, headers, detectedEmailColumn: anyEmailKey, detectedNameColumn: nameKey || null, invalid: rows.length - recipients.length })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const recipients: { email: string; name: string; row?: number }[] = []
    let invalid = 0
    rows.forEach((r, idx) => {
      const email = (r[emailKey] || '').trim()
      const name = nameKey ? (r[nameKey] || '').trim() : ''
      if (email && emailRegex.test(email)) {
        recipients.push({ email, name })
      } else {
        invalid++
      }
    })

    // Deduplicate by email
    const seen = new Set<string>()
    const deduped = recipients.filter((r) => {
      const key = r.email.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    return NextResponse.json({
      recipients: deduped,
      totalRows: rows.length,
      duplicatesRemoved: recipients.length - deduped.length,
      invalid,
      headers,
      detectedEmailColumn: emailKey,
      detectedNameColumn: nameKey || null,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to parse CSV' }, { status: 500 })
  }
}

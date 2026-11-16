'use client'

/**
 * Icon layer: Tabler icons (no stars, no lucide) re-exported under the friendly
 * names used across MailPulse. Plus <DuoTile> — the "duo style" wrapper that
 * pairs an outline icon with a soft tinted brand tile.
 */
import type { ComponentType } from 'react'
import {
  IconCloudUpload, IconFileSpreadsheet, IconArrowRight, IconArrowLeft, IconSend,
  IconPaperclip, IconX, IconMail, IconPencil, IconPhoto, IconCircleCheck,
  IconAlertTriangle, IconLoader2, IconDeviceFloppy, IconFileText, IconShieldCheck,
  IconBolt, IconSettings2, IconUser, IconLink, IconBold, IconItalic, IconEye,
  IconSparkles, IconDownload, IconArrowBackUp, IconTrash, IconAlertCircle, IconInfoCircle,
  IconPlayerPause, IconPlayerPlay, IconCircleX, IconRefresh, IconClock, IconCalendar,
  IconServer, IconExternalLink, IconCopy, IconRadio, IconEraser, IconUsers, IconSearch,
  IconColorPicker,
  IconChevronLeft, IconChevronRight, IconMailCheck, IconMailX, IconPlus, IconHistory,
  IconSun, IconMoon, IconChartBar, IconLoader, IconClipboardText, IconUserPlus, IconBuilding,
  IconTag, IconListDetails,
} from '@tabler/icons-react'

// Friendly names (lucide-style) → Tabler
export const UploadCloud = IconCloudUpload
export const FileSpreadsheet = IconFileSpreadsheet
export const ArrowRight = IconArrowRight
export const ArrowLeft = IconArrowLeft
export const Send = IconSend
export const Paperclip = IconPaperclip
export const X = IconX
export const Mail = IconMail
export const PenLine = IconPencil
export const ImageIcon = IconPhoto
export const CheckCircle2 = IconCircleCheck
export const AlertTriangle = IconAlertTriangle
export const Loader2 = IconLoader2
export const Save = IconDeviceFloppy
export const FileText = IconFileText
export const ShieldCheck = IconShieldCheck
export const Zap = IconBolt
export const Settings2 = IconSettings2
export const User = IconUser
export const Link2 = IconLink
export const Bold = IconBold
export const Italic = IconItalic
export const Eye = IconEye
export const Sparkles = IconSparkles
export const Download = IconDownload
export const RotateCcw = IconArrowBackUp
export const Trash2 = IconTrash
export const CircleAlert = IconAlertCircle
export const AlertCircle = IconAlertCircle
export const Info = IconInfoCircle
export const Pause = IconPlayerPause
export const Play = IconPlayerPlay
export const XCircle = IconCircleX
export const FailIcon = IconCircleX
export const RefreshCw = IconRefresh
export const Clock = IconClock
export const Calendar = IconCalendar
export const Server = IconServer
export const ColorPicker = IconColorPicker
export const ExternalLink = IconExternalLink
export const Copy = IconCopy
export const Radio = IconRadio
export const Eraser = IconEraser
export const Users = IconUsers
export const Search = IconSearch
export const ChevronLeft = IconChevronLeft
export const ChevronRight = IconChevronRight
export const MailCheck = IconMailCheck
export const MailX = IconMailX
export const Plus = IconPlus
export const History = IconHistory
export const Sun = IconSun
export const Moon = IconMoon
export const BarChart3 = IconChartBar
export const Loader = IconLoader
export const ClipboardText = IconClipboardText
export const UserPlus = IconUserPlus
export const Building = IconBuilding
export const Tag = IconTag
export const ListIcon = IconListDetails

type IconType = ComponentType<{ className?: string; size?: number | string; stroke?: number | string }>

/**
 * DuoTile — "duo style" icon: soft brand-tinted tile behind a stronger icon.
 * For section headers, sidebar items and step highlights.
 */
export function DuoTile({
  icon: Icon,
  tone = 'brand',
  size = 'md',
  className = '',
}: {
  icon: IconType
  tone?: 'brand' | 'emerald' | 'amber' | 'rose'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const tiles: Record<string, string> = {
    brand: 'bg-blue-500/10 text-blue-600 ring-1 ring-blue-500/20 dark:text-blue-300',
    emerald: 'bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20 dark:text-emerald-300',
    amber: 'bg-amber-500/10 text-amber-600 ring-1 ring-amber-500/20 dark:text-amber-300',
    rose: 'bg-rose-500/10 text-rose-600 ring-1 ring-rose-500/20 dark:text-rose-300',
  }
  const dims = size === 'sm' ? 'h-7 w-7' : size === 'lg' ? 'h-11 w-11' : 'h-9 w-9'
  const iconSize = size === 'sm' ? 15 : size === 'lg' ? 22 : 18
  return (
    <span className={`${dims} ${tiles[tone]} rounded-lg inline-flex items-center justify-center shrink-0 ${className}`} aria-hidden>
      <Icon size={iconSize} stroke={2} />
    </span>
  )
}

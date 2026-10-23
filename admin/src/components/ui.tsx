import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
} from 'react'
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router'
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { parseInline } from '@marino/content-schema'
import { statusLabel, statusTone } from '../lib/format'

/* ---------------------------------------------------------------- basics -- */

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'quiet' | 'danger'
type ButtonSize = 'sm' | 'md'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-obsidian hover:shadow-soft',
  secondary: 'bg-obsidian text-white hover:bg-obsidian/90',
  outline: 'border border-obsidian/15 bg-white text-obsidian hover:bg-fog',
  ghost: 'text-obsidian hover:bg-obsidian/5',
  quiet: 'bg-white/60 text-obsidian hover:bg-white',
  danger: 'bg-obsidian text-white hover:bg-obsidian/90',
}

export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className = '',
): string {
  return cn(
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-button font-medium',
    'transition-[background-color,box-shadow,color] duration-[350ms] ease-[var(--ease-standard)]',
    'disabled:cursor-not-allowed disabled:opacity-45',
    size === 'sm' ? 'h-9 px-4 text-[13px]' : 'h-11 px-6 text-sm',
    VARIANTS[variant],
    className,
  )
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: LucideIcon
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon: Icon,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      className={buttonClass(variant, size, className)}
    >
      {loading ? (
        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
      ) : Icon ? (
        <Icon size={16} strokeWidth={1.7} aria-hidden="true" />
      ) : null}
      {children}
    </button>
  )
}

/* ----------------------------------------------------------------- fields -- */

type FieldExtras = {
  label?: string
  hint?: string
  error?: string
  counter?: string
  required?: boolean
  leading?: LucideIcon
}

type InputProps = FieldExtras &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'required'>

export function TextInput({
  label,
  hint,
  error,
  counter,
  required,
  leading: Leading,
  className,
  id,
  ...props
}: InputProps) {
  const generated = useId()
  const inputId = id ?? generated
  const messageId = `${inputId}-message`

  return (
    <div className="flex flex-col gap-1.5">
      {(label || counter) && (
        <div className="flex items-baseline justify-between gap-3">
          {label && (
            <label htmlFor={inputId} className="text-[13px] font-semibold text-obsidian">
              {label}
              {required && (
                <span className="ml-1 text-obsidian/40" aria-hidden="true">
                  *
                </span>
              )}
            </label>
          )}
          {counter && <span className="text-[11px] tabular-nums text-obsidian/45">{counter}</span>}
        </div>
      )}
      <div className="relative">
        {Leading && (
          <Leading
            size={16}
            strokeWidth={1.7}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-obsidian/40"
            aria-hidden="true"
          />
        )}
        <input
          {...props}
          id={inputId}
          required={required}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={hint || error ? messageId : undefined}
          className={cn(
            'h-11 w-full rounded-input border bg-white px-4 text-sm text-obsidian',
            'placeholder:text-obsidian/35',
            Leading && 'pl-10',
            error ? 'border-obsidian' : 'border-obsidian/15',
            className,
          )}
        />
      </div>
      {(hint || error) && (
        <p
          id={messageId}
          className={cn('text-[12px] leading-4', error ? 'font-medium text-obsidian' : 'text-obsidian/55')}
        >
          {error || hint}
        </p>
      )}
    </div>
  )
}

type TextareaProps = FieldExtras &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'required'>

export function Textarea({
  label,
  hint,
  error,
  counter,
  required,
  className,
  id,
  ...props
}: TextareaProps) {
  const generated = useId()
  const inputId = id ?? generated
  const messageId = `${inputId}-message`

  return (
    <div className="flex flex-col gap-1.5">
      {(label || counter) && (
        <div className="flex items-baseline justify-between gap-3">
          {label && (
            <label htmlFor={inputId} className="text-[13px] font-semibold text-obsidian">
              {label}
              {required && (
                <span className="ml-1 text-obsidian/40" aria-hidden="true">
                  *
                </span>
              )}
            </label>
          )}
          {counter && <span className="text-[11px] tabular-nums text-obsidian/45">{counter}</span>}
        </div>
      )}
      <textarea
        {...props}
        id={inputId}
        required={required}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={hint || error ? messageId : undefined}
        className={cn(
          'min-h-[110px] w-full resize-y rounded-card-lg border bg-white px-4 py-3 text-sm leading-6 text-obsidian',
          'placeholder:text-obsidian/35',
          error ? 'border-obsidian' : 'border-obsidian/15',
          className,
        )}
      />
      {(hint || error) && (
        <p
          id={messageId}
          className={cn('text-[12px] leading-4', error ? 'font-medium text-obsidian' : 'text-obsidian/55')}
        >
          {error || hint}
        </p>
      )}
    </div>
  )
}

type SelectProps = FieldExtras &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'required' | 'children'> & {
    options: readonly { value: string; label: string }[]
    placeholder?: string
  }

export function Select({
  label,
  hint,
  error,
  required,
  className,
  id,
  options,
  placeholder,
  ...props
}: SelectProps) {
  const generated = useId()
  const inputId = id ?? generated
  const messageId = `${inputId}-message`

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-[13px] font-semibold text-obsidian">
          {label}
          {required && (
            <span className="ml-1 text-obsidian/40" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      <div className="relative">
        <select
          {...props}
          id={inputId}
          required={required}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={hint || error ? messageId : undefined}
          className={cn(
            'h-11 w-full appearance-none rounded-input border bg-white px-4 pr-10 text-sm text-obsidian',
            error ? 'border-obsidian' : 'border-obsidian/15',
            className,
          )}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          strokeWidth={1.7}
          className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-obsidian/45"
          aria-hidden="true"
        />
      </div>
      {(hint || error) && (
        <p
          id={messageId}
          className={cn('text-[12px] leading-4', error ? 'font-medium text-obsidian' : 'text-obsidian/55')}
        >
          {error || hint}
        </p>
      )}
    </div>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search',
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={cn('relative', className)}>
      <Search
        size={16}
        strokeWidth={1.7}
        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-obsidian/40"
        aria-hidden="true"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-11 w-full rounded-input border border-obsidian/15 bg-white pl-10 pr-4 text-sm text-obsidian placeholder:text-obsidian/35"
      />
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  description?: string
  disabled?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      {(label || description) && (
        <div className="min-w-0">
          {label && <p className="text-[13px] font-semibold">{label}</p>}
          {description && <p className="mt-0.5 text-[12px] leading-4 text-obsidian/55">{description}</p>}
        </div>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label ?? 'Toggle'}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-7 w-12 shrink-0 rounded-pill border transition-colors duration-[350ms]',
          checked ? 'border-primary bg-primary' : 'border-obsidian/20 bg-obsidian/10',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span
          className={cn(
            'absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow-sm transition-[left] duration-[350ms]',
            checked ? 'left-[25px]' : 'left-1',
          )}
        />
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ chrome -- */

type BadgeTone = 'mint' | 'lavender' | 'neutral' | 'dark' | 'outline'

const BADGE: Record<BadgeTone, string> = {
  mint: 'bg-primary/45 text-obsidian',
  lavender: 'bg-secondary/45 text-obsidian',
  neutral: 'bg-fog text-obsidian/65',
  dark: 'bg-obsidian text-white',
  outline: 'border border-obsidian/15 bg-transparent text-obsidian/70',
}

export function Badge({
  tone = 'neutral',
  children,
  dot = false,
}: {
  tone?: BadgeTone
  children: ReactNode
  dot?: boolean
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 text-[11px] font-semibold',
        BADGE[tone],
      )}
    >
      {dot && (
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            tone === 'dark' ? 'bg-primary' : 'bg-obsidian/50',
          )}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  )
}

export function StatusBadge({
  status,
  changed,
  hasPublished,
}: {
  status: string
  changed?: boolean
  hasPublished?: boolean
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone={statusTone(status)} dot>
        {statusLabel(status)}
      </Badge>
      {changed && hasPublished && <Badge tone="outline">Changed</Badge>}
    </span>
  )
}

export function Panel({
  children,
  className,
  as: As = 'section',
}: {
  children: ReactNode
  className?: string
  as?: 'section' | 'div' | 'article'
}) {
  return (
    <As className={cn('rounded-panel bg-white p-[25px] shadow-soft lg:p-[var(--space-40)]', className)}>
      {children}
    </As>
  )
}

export function PanelHeading({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-[18px] font-bold">{title}</h3>
        {description && <p className="mt-1 text-[13px] leading-5 text-obsidian/60">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  backTo,
  backLabel = 'Back',
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
  backTo?: string
  backLabel?: string
}) {
  return (
    <div className="mb-[25px]">
      {backTo && (
        <Link
          to={backTo}
          className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-obsidian/60 transition-colors hover:text-obsidian"
        >
          <ArrowLeft size={14} strokeWidth={1.8} aria-hidden="true" />
          {backLabel}
        </Link>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-obsidian/55">
              <span className="h-1.5 w-1.5 rounded-full bg-secondary" aria-hidden="true" />
              {eyebrow}
            </p>
          )}
          <h2 className="text-[28px] font-bold leading-tight sm:text-[33px]">{title}</h2>
          {description && (
            <p className="mt-2 max-w-[760px] text-sm leading-6 text-obsidian/60">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {Icon && (
        <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-fog">
          <Icon size={24} strokeWidth={1.4} className="text-obsidian/55" aria-hidden="true" />
        </span>
      )}
      <h3 className="text-[18px] font-bold">{title}</h3>
      {description && <p className="mt-2 max-w-[480px] text-sm leading-6 text-obsidian/60">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({
  error,
  onRetry,
  compact = false,
}: {
  error: Error
  onRetry?: () => void
  compact?: boolean
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-start gap-3 rounded-card-lg border border-obsidian/15 bg-white',
        compact ? 'p-4' : 'p-6',
      )}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-obsidian text-white">
          <AlertCircle size={16} strokeWidth={1.7} />
        </span>
        <div>
          <p className="text-sm font-semibold">That did not work</p>
          <p className="mt-1 text-[13px] leading-5 text-obsidian/60">{error.message}</p>
        </div>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" icon={RefreshCw} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-label="Loading" role="status" className="flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-12 animate-pulse rounded-card-lg bg-fog" />
      ))}
    </div>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-obsidian/60">
      <Loader2 size={16} className="animate-spin" aria-hidden="true" />
      {label}
    </span>
  )
}

/* ------------------------------------------------------------------ modal -- */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const focusTimer = window.setTimeout(() => {
      const target = panelRef.current?.querySelector<HTMLElement>(
        'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )
      target?.focus()
    }, 20)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }

      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null)

      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = overflow
      previous?.focus()
    }
  }, [open])

  if (!open) return null

  const widths = {
    sm: 'max-w-[480px]',
    md: 'max-w-[640px]',
    lg: 'max-w-[820px]',
    xl: 'max-w-[1040px]',
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-[25px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={cn(
          'flex max-h-[92svh] w-full flex-col overflow-hidden rounded-t-panel bg-white shadow-float sm:rounded-panel',
          widths[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-obsidian/10 px-[25px] py-5">
          <div>
            <h3 id="modal-title" className="text-[20px] font-bold">
              {title}
            </h3>
            {description && <p className="mt-1 text-[13px] leading-5 text-obsidian/60">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-obsidian/60 transition-colors hover:bg-fog hover:text-obsidian"
          >
            <X size={18} strokeWidth={1.7} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-[25px] py-5">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-obsidian/10 px-[25px] py-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Delete',
  loading = false,
  destructive = true,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  loading?: boolean
  destructive?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="rounded-card-lg bg-fog p-4 text-[13px] leading-5 text-obsidian/65">
        This action is recorded in the activity log.
      </div>
    </Modal>
  )
}

/* --------------------------------------------------------------- pagination -- */

export function Pagination({
  page,
  total,
  limit,
  onPage,
}: {
  page: number
  total: number
  limit: number
  onPage: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / limit))
  const from = total === 0 ? 0 : (page - 1) * limit + 1
  const to = Math.min(page * limit, total)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-obsidian/10 px-1 pt-4">
      <p className="text-[12px] text-obsidian/55">
        {total === 0 ? 'No results' : `Showing ${from}–${to} of ${total}`}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          icon={ChevronLeft}
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </Button>
        <span className="px-1 text-[12px] tabular-nums text-obsidian/55">
          {page} / {pages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
          <ChevronRight size={14} strokeWidth={1.8} aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------- tabs -- */

export function Tabs({
  value,
  onChange,
  items,
}: {
  value: string
  onChange: (value: string) => void
  items: readonly { value: string; label: string; count?: number }[]
}) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 rounded-pill bg-fog p-1">
      {items.map((item) => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-pill px-4 text-[13px] font-medium transition-colors duration-[350ms]',
              active ? 'bg-white text-obsidian shadow-soft' : 'text-obsidian/60 hover:text-obsidian',
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span
                className={cn(
                  'rounded-pill px-1.5 py-0.5 text-[10px] tabular-nums',
                  active ? 'bg-primary/50' : 'bg-obsidian/5',
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* --------------------------------------------------------------- rich inline -- */

export function RichTextPreview({ value, className }: { value: string; className?: string }) {
  const paragraphs = parseInline(value)
  if (paragraphs.length === 0) {
    return <p className="text-[13px] italic text-obsidian/40">Nothing to preview yet.</p>
  }

  return (
    <div className={cn('flex flex-col gap-2 text-[13px] leading-6 text-obsidian/75', className)}>
      {paragraphs.map((paragraph, paragraphIndex) => (
        <p key={paragraphIndex}>
          {paragraph.map((node, nodeIndex) => {
            if (node.type === 'bold') return <strong key={nodeIndex}>{node.value}</strong>
            if (node.type === 'highlight')
              return (
                <mark key={nodeIndex} className="rounded-[4px] bg-secondary px-1 text-obsidian">
                  {node.value}
                </mark>
              )
            if (node.type === 'link')
              return (
                <a
                  key={nodeIndex}
                  href={node.to}
                  className="underline decoration-obsidian/30 underline-offset-2 hover:decoration-obsidian"
                >
                  {node.value}
                </a>
              )
            return <span key={nodeIndex}>{node.value}</span>
          })}
        </p>
      ))}
    </div>
  )
}

/* --------------------------------------------------------------- misc bits -- */

export function FieldErrors({ errors }: { errors: { path: string; message: string }[] }) {
  if (errors.length === 0) return null
  return (
    <div role="alert" className="rounded-card-lg border border-obsidian/20 bg-white p-4">
      <p className="text-[13px] font-semibold">Please fix these fields</p>
      <ul className="mt-2 flex flex-col gap-1 text-[12px] text-obsidian/65">
        {errors.slice(0, 8).map((error, index) => (
          <li key={`${error.path}-${index}`}>
            <span className="font-mono text-[11px] text-obsidian/45">{error.path || 'record'}</span>
            {' — '}
            {error.message}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function InlineMeta({ children }: { children: ReactNode }) {
  return <span className="text-[12px] text-obsidian/50">{children}</span>
}

export const ThemeContext = createContext<'light'>('light')
export function useTheme() {
  return useContext(ThemeContext)
}

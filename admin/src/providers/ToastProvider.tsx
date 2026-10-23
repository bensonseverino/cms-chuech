import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'

/*
 * Toasts are the only transient feedback in the admin. Errors are still shown
 * inline where they belong; a toast is for the result of an action that has
 * already closed its form.
 */

export type ToastTone = 'success' | 'error' | 'info'
export type ToastInput = { title: string; description?: string; tone?: ToastTone }

type ToastItem = ToastInput & { id: string; tone: ToastTone }

type ToastContextValue = {
  push: (toast: ToastInput | string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const counter = useRef(0)

  const dismiss = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  const push = useCallback((input: ToastInput | string) => {
    counter.current += 1
    const toast: ToastItem =
      typeof input === 'string'
        ? { id: `toast-${counter.current}`, title: input, tone: 'success' }
        : {
            ...input,
            id: `toast-${counter.current}`,
            tone: input.tone ?? 'success',
          }

    setItems((current) => [...current.slice(-3), toast])
  }, [])

  const value = useMemo(() => ({ push }), [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-[25px] right-[25px] z-[80] flex w-[min(380px,calc(100vw-50px))] flex-col gap-2"
      >
        {items.map((item) => (
          <ToastCard key={item.id} toast={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, toast.tone === 'error' ? 7000 : 4500)
    return () => window.clearTimeout(timer)
  }, [onDismiss, toast.tone])

  const Icon = toast.tone === 'success' ? CheckCircle2 : toast.tone === 'error' ? AlertCircle : Info

  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className="pointer-events-auto flex items-start gap-3 rounded-panel border border-obsidian/10 bg-white p-4 text-obsidian shadow-soft"
    >
      <span
        className={[
          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          toast.tone === 'success'
            ? 'bg-primary/40'
            : toast.tone === 'error'
              ? 'bg-obsidian text-white'
              : 'bg-secondary/50',
        ].join(' ')}
      >
        <Icon size={16} strokeWidth={1.7} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{toast.title}</p>
        {toast.description && (
          <p className="mt-1 break-words text-[13px] leading-5 text-obsidian/70">
            {toast.description}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-obsidian/50 transition-colors hover:bg-fog hover:text-obsidian"
      >
        <X size={14} strokeWidth={1.7} />
      </button>
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { apiRequest } from '../api/client'

/*
 * Tiny read hook. Screens pass a path (or null to skip) and get the usual
 * loading/error/data triple. The AbortController means a fast route change
 * cannot land stale data on the next screen.
 */

export type ApiState<T> = {
  data: T | null
  error: Error | null
  loading: boolean
  reload: () => void
  setData: Dispatch<SetStateAction<T | null>>
}

export function useApi<T>(path: string | null): ApiState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(Boolean(path))
  const [nonce, setNonce] = useState(0)
  const lastPath = useRef<string | null>(null)

  useEffect(() => {
    if (!path) {
      lastPath.current = null
      setLoading(false)
      setData(null)
      setError(null)
      return
    }

    // A new URL is a new record: clear the previous payload so a detail screen
    // cannot render the last entity under a new set of params while loading.
    if (lastPath.current !== path) {
      lastPath.current = path
      setData(null)
      setLoading(true)
      setError(null)
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    apiRequest<T>(path, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setData(value)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setError(cause instanceof Error ? cause : new Error(String(cause)))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [path, nonce])

  const reload = useCallback(() => {
    setNonce((value) => value + 1)
  }, [])

  return { data, error, loading, reload, setData }
}

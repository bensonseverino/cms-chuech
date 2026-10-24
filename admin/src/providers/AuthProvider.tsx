import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useApi } from '../hooks/useApi'
import type { MeResponse } from '../api/types'

/*
 * `/api/auth/me` is the one auth check the SPA uses. It sees password sessions
 * and can be safely called before the admin shell is up; `/api/admin/me` is
 * still the identity endpoint behind a deployed route.
 */

export type AuthState = {
  me: MeResponse | null
  loading: boolean
  error: Error | null
  reload: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, loading, error, reload } = useApi<MeResponse>('/api/auth/me')
  const value = useMemo<AuthState>(
    () => ({ me: data, loading, error, reload }),
    [data, error, loading, reload],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}

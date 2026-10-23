import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useApi } from '../hooks/useApi'
import type { MeResponse } from '../api/types'

/*
 * `/me` is fetched once for the shell and shared by every screen. It carries
 * both identity and the capability flags, so a button is hidden for the same
 * reason the API would reject it rather than a second, drifting role check.
 */

export type AuthState = {
  me: MeResponse | null
  loading: boolean
  error: Error | null
  reload: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, loading, error, reload } = useApi<MeResponse>('/me')
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

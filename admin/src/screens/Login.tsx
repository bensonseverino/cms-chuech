import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { api, errorMessage } from '../api/client'
import { useAuth } from '../providers/AuthProvider'
import { Button, TextInput } from '../components/ui'

/*
 * `cms-auto-login-spec.md`: no credential prompt if a valid session exists,
 * otherwise show the login card. Local dev adds a zero-click auto-login.
 */

export default function Login() {
  const { me, loading, reload } = useAuth()
  const [email, setEmail] = useState(() => localStorage.getItem('cms:lastEmail') ?? '')
  const [password, setPassword] = useState('')
  const [keepSignedIn, setKeepSignedIn] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [devAttempted, setDevAttempted] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (import.meta.env.PROD || devAttempted) return
    setDevAttempted(true)
    api.post('/api/auth/dev-auto-login')
      .catch(() => null)
      .then(() => reload())
  }, [devAttempted, reload])

  useEffect(() => {
    if (me) navigate('/', { replace: true })
  }, [me, navigate])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/api/auth/login', { email, password, keepSignedIn })
      localStorage.setItem('cms:lastEmail', email)
      reload()
      navigate('/', { replace: true })
    } catch (cause) {
      setError(errorMessage(cause) || 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading && !me) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-fog px-6">
        <div className="w-full max-w-[380px] rounded-panel bg-white p-8 shadow-soft">
          <span className="block text-[18px] font-bold tracking-[0.18em] text-obsidian">CHUECH</span>
          <span className="mt-4 block text-[14px] text-obsidian/60">Checking your session…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-fog px-6">
      <form
        className="w-full max-w-[380px] rounded-panel bg-white p-8 shadow-soft"
        onSubmit={submit}
      >
        <span className="block text-[18px] font-bold tracking-[0.18em] text-obsidian">CHUECH</span>
        <h1 className="mt-4 text-[22px] font-bold leading-tight">Sign in to Chuech CMS</h1>

        <div className="mt-6 grid gap-3">
          <TextInput
            label="Email"
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setEmail(event.target.value)
            }
          />
          <TextInput
            label="Password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setPassword(event.target.value)
            }
          />
        </div>

        <label className="mt-4 flex items-center gap-2 text-[13px] text-obsidian/70">
          <input
            type="checkbox"
            checked={keepSignedIn}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setKeepSignedIn(event.target.checked)
            }
            className="h-4 w-4 accent-obsidian"
          />
          Keep me signed in
        </label>

        {error ? (
          <p role="alert" className="mt-3 rounded-card-lg bg-red-50 p-3 text-[12px] leading-5 text-red-700">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={busy} className="mt-5 w-full">
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  )
}

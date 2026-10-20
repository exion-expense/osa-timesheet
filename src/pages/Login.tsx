import { Lock } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { Logo } from '../components/Layout'
import { Button, Field, Input } from '../components/ui'
import { useAuth } from '../lib/auth'
import { errMsg, supabase } from '../lib/supabase'

export default function Login() {
  const { session, loading, mfaRequired } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!loading && session) return <Navigate to={mfaRequired ? '/mfa' : (loc.state as { from?: string })?.from || '/'} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setError(errMsg(error))
    else nav('/', { replace: true })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 via-white to-slate-100 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="h-14" />
          <p className="mt-4 text-sm font-medium text-slate-500">ระบบลงเวลาและคิดค่าแรงผู้รับเหมา</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <Field label="อีเมล">
            <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="รหัสผ่าน">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            <Lock className="size-4" /> เข้าสู่ระบบ
          </Button>
        </form>
        <p className="mt-6 text-center text-xs text-slate-400">
          สำหรับพนักงาน OSA เท่านั้น · <Link to="/privacy" className="underline">นโยบายความเป็นส่วนตัว</Link>
        </p>
      </div>
    </div>
  )
}

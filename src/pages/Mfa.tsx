import { ShieldCheck } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { Logo } from '../components/Layout'
import { Button, Field, Input, Spinner } from '../components/ui'
import { useAuth } from '../lib/auth'
import { roleHome } from '../lib/nav'
import { errMsg, supabase } from '../lib/supabase'

/** ยืนยันตัวตน 2 ชั้นด้วยแอป Authenticator (Google Authenticator / Microsoft Authenticator) */
export default function Mfa() {
  const { session, loading, mfaRequired, refresh, signOut, profile } = useAuth()
  const nav = useNavigate()
  const [factorId, setFactorId] = useState<string | null>(null)
  const [enroll, setEnroll] = useState<{ qr: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!session) return
    ;(async () => {
      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error) return setError(errMsg(error))
      const verified = data.totp.find((f) => f.status === 'verified')
      if (verified) {
        setFactorId(verified.id)
      } else {
        // ลบ factor ที่ค้างไม่ได้ยืนยัน แล้วสร้างใหม่
        for (const f of data.all.filter((f) => f.status !== 'verified')) await supabase.auth.mfa.unenroll({ factorId: f.id })
        const r = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'OSA Timesheet' })
        if (r.error) return setError(errMsg(r.error))
        setFactorId(r.data.id)
        setEnroll({ qr: r.data.totp.qr_code, secret: r.data.totp.secret })
      }
      setReady(true)
    })()
  }, [session])

  if (loading) return <Spinner />
  if (!session) return <Navigate to="/login" replace />
  if (!mfaRequired) return <Navigate to={roleHome(profile?.role)} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!factorId) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() })
    setBusy(false)
    if (error) return setError('รหัสไม่ถูกต้องหรือหมดเวลา ลองใหม่อีกครั้ง')
    await refresh()
    nav(roleHome(profile?.role), { replace: true })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 via-white to-slate-100 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo className="h-12" />
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2 text-slate-900">
            <ShieldCheck className="size-5 text-brand-600" />
            <h1 className="font-semibold">ยืนยันตัวตน 2 ชั้น</h1>
          </div>
          {!ready && !error && <Spinner />}
          {enroll && (
            <div className="space-y-3 text-sm text-slate-600">
              <p>ตำแหน่งของคุณต้องใช้รหัสจากแอป Authenticator ทุกครั้งที่เข้าระบบ</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>ติดตั้ง Google Authenticator หรือ Microsoft Authenticator บนมือถือ</li>
                <li>สแกน QR ด้านล่าง</li>
                <li>กรอกรหัส 6 หลักที่แอปแสดง</li>
              </ol>
              <div className="flex justify-center rounded-xl border border-slate-200 bg-white p-3">
                <img src={enroll.qr} alt="QR สำหรับแอป Authenticator" className="size-44" />
              </div>
              <p className="break-all rounded-lg bg-slate-50 p-2 text-center font-mono text-xs">{enroll.secret}</p>
            </div>
          )}
          {ready && !enroll && <p className="text-sm text-slate-600">กรอกรหัส 6 หลักจากแอป Authenticator</p>}
          {ready && (
            <Field label="รหัส 6 หลัก">
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="text-center text-lg tracking-[0.5em]"
              />
            </Field>
          )}
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!ready || code.length !== 6}>
            ยืนยัน
          </Button>
          <button type="button" onClick={signOut} className="w-full text-center text-sm text-slate-500 hover:underline">
            ออกจากระบบ
          </button>
        </form>
      </div>
    </div>
  )
}

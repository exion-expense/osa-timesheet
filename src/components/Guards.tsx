import { ShieldAlert } from 'lucide-react'
import { Suspense } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from '../lib/auth'
import { Button, Spinner } from './ui'

export function RequireStaff() {
  const { loading, session, profile, mfaRequired, signOut } = useAuth()
  const loc = useLocation()

  if (loading) return <Spinner />
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  if (mfaRequired) return <Navigate to="/mfa" replace />
  if (!profile?.role || !profile.active) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <ShieldAlert className="mx-auto size-10 text-amber-500" />
          <h1 className="mt-3 text-lg font-semibold">บัญชียังไม่ได้รับสิทธิ์</h1>
          <p className="mt-1 text-sm text-slate-500">
            {session.user.email} — กรุณาแจ้งแอดมินให้กำหนดตำแหน่งให้ก่อนใช้งาน
          </p>
          <Button variant="secondary" className="mt-5" onClick={signOut}>
            ออกจากระบบ
          </Button>
        </div>
      </div>
    )
  }
  return (
    <Suspense fallback={<Spinner />}>
      <Outlet />
    </Suspense>
  )
}

export function Forbidden() {
  return (
    <div className="py-20 text-center text-slate-500">
      <ShieldAlert className="mx-auto mb-2 size-8" />
      ไม่มีสิทธิ์เข้าหน้านี้
    </div>
  )
}

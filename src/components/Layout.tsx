import { BriefcaseBusiness, Calculator, CalendarClock, ClipboardCheck, History, KeyRound, LayoutDashboard, LogOut, Menu, Settings, Users, X } from 'lucide-react'
import { Suspense, useState } from 'react'
import { NavLink, Outlet } from 'react-router'
import { useAuth } from '../lib/auth'
import { ROLE_LABEL } from '../lib/types'
import { ChangePassword } from './ChangePassword'
import { cx, Spinner } from './ui'

export function Logo({ className }: { className?: string }) {
  return <img src={`${import.meta.env.BASE_URL}brand/osa-logo.png`} alt="OSA Valve Thailand" className={cx('h-9 w-auto', className)} />
}

export function Layout() {
  const { profile, is, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)

  const nav = [
    ...(is('supervisor', 'admin') ? [{ to: '/today', label: 'ลงเวลาวันนี้', icon: CalendarClock }] : []),
    { to: '/', label: 'ภาพรวม', icon: LayoutDashboard, end: true },
    { to: '/inbox', label: 'งานรออนุมัติ', icon: ClipboardCheck },
    { to: '/jobs', label: 'จ็อบ', icon: BriefcaseBusiness },
    ...(is('purchase', 'admin', 'planner') ? [{ to: '/costs', label: 'คิดราคา', icon: Calculator }] : []),
    ...(is('admin')
      ? [
          { to: '/admin/users', label: 'ผู้ใช้งาน', icon: Users },
          { to: '/admin/settings', label: 'ตั้งค่า', icon: Settings },
          { to: '/admin/audit', label: 'ประวัติการแก้ไข', icon: History },
        ]
      : []),
  ]

  const links = (
    <nav className="flex flex-col gap-1">
      {nav.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            cx(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
              isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
            )
          }
        >
          <n.icon className="size-5" />
          {n.label}
        </NavLink>
      ))}
    </nav>
  )

  const me = (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
        {(profile?.full_name || profile?.email || '?').slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">{profile?.full_name || profile?.email}</p>
        <p className="text-xs text-slate-500">{profile?.role ? ROLE_LABEL[profile.role] : ''}</p>
      </div>
      <button onClick={() => setPwOpen(true)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="เปลี่ยนรหัสผ่าน" aria-label="เปลี่ยนรหัสผ่าน">
        <KeyRound className="size-4" />
      </button>
      <button onClick={signOut} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="ออกจากระบบ" aria-label="ออกจากระบบ">
        <LogOut className="size-4" />
      </button>
    </div>
  )

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="no-print fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-slate-200 bg-white px-4 py-5 lg:flex">
        <div className="mb-6 px-2">
          <Logo />
          <p className="mt-2 text-xs font-medium tracking-wide text-slate-400">CONTRACTOR TIMESHEET</p>
        </div>
        <div className="flex-1">{links}</div>
        {me}
      </aside>

      <header className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <Logo className="h-7" />
        <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="เมนู">
          <Menu className="size-5" />
        </button>
      </header>

      {open && (
        <div className="no-print fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="flex h-full w-72 flex-col bg-white p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-6 flex items-center justify-between">
              <Logo className="h-7" />
              <button onClick={() => setOpen(false)} className="rounded-lg p-2 hover:bg-slate-100" aria-label="ปิดเมนู">
                <X className="size-5" />
              </button>
            </div>
            <div className="flex-1">{links}</div>
            {me}
          </div>
        </div>
      )}

      <ChangePassword open={pwOpen} onClose={() => setPwOpen(false)} />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <Suspense fallback={<Spinner />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}

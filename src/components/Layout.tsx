import { BriefcaseBusiness, Calculator, CalendarClock, ClipboardCheck, History, KeyRound, LayoutDashboard, ListChecks, LogOut, Menu, Settings, Users, X, type LucideIcon } from 'lucide-react'
import { Suspense, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { useAuth } from '../lib/auth'
import { roleHome, usePendingCounts } from '../lib/nav'
import { ROLE_LABEL, type Role } from '../lib/types'
import { ChangePassword } from './ChangePassword'
import { cx, Spinner } from './ui'

export function Logo({ className }: { className?: string }) {
  return <img src={`${import.meta.env.BASE_URL}brand/osa-logo.png`} alt="OSA Valve Thailand" className={cx('h-9 w-auto', className)} />
}

type Item = { to: string; label: string; short?: string; icon: LucideIcon; end?: boolean }

const ITEMS: Record<string, Item> = {
  today: { to: '/today', label: 'ลงเวลาวันนี้', short: 'วันนี้', icon: CalendarClock },
  home: { to: '/', label: 'ภาพรวม', icon: LayoutDashboard, end: true },
  status: { to: '/status', label: 'สถานะงาน', short: 'สถานะ', icon: ListChecks },
  inbox: { to: '/inbox', label: 'งานรออนุมัติ', short: 'รออนุมัติ', icon: ClipboardCheck },
  costs: { to: '/costs', label: 'คิดราคา', icon: Calculator },
  jobs: { to: '/jobs', label: 'จ็อบ', icon: BriefcaseBusiness },
  users: { to: '/admin/users', label: 'ผู้ใช้งาน', icon: Users },
  settings: { to: '/admin/settings', label: 'ตั้งค่า', icon: Settings },
  audit: { to: '/admin/audit', label: 'ประวัติการแก้ไข', icon: History },
}

/** เมนูเรียงตามงานที่ใช้บ่อยของแต่ละตำแหน่ง — 4 อันแรกขึ้นแถบล่างบนมือถือ */
const MENU: Record<Role, string[]> = {
  supervisor: ['today', 'inbox', 'status', 'jobs', 'home'],
  planner: ['inbox', 'status', 'jobs', 'home', 'costs'],
  purchase: ['costs', 'status', 'jobs', 'home'],
  manager: ['inbox', 'costs', 'status', 'home', 'jobs', 'audit'],
  admin: ['home', 'today', 'status', 'jobs', 'inbox', 'costs', 'users', 'settings', 'audit'],
}

export function Layout() {
  const { profile, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)
  const counts = usePendingCounts(profile?.role, profile?.id)
  const nav = (profile?.role ? MENU[profile.role] : ['home']).map((k) => ITEMS[k])
  const bottom = nav.slice(0, 4)

  const badge = (to: string, small?: boolean) =>
    counts[to] ? (
      <span
        className={cx(
          'tabular inline-flex items-center justify-center rounded-full bg-rose-500 font-semibold text-white',
          small ? 'absolute -top-1 left-1/2 ml-1.5 h-4 min-w-4 px-1 text-[10px]' : 'ml-auto h-5 min-w-5 px-1.5 text-xs',
        )}
      >
        {counts[to] > 99 ? '99+' : counts[to]}
      </span>
    ) : null

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
          {badge(n.to)}
        </NavLink>
      ))}
    </nav>
  )

  const me = (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
        {(profile?.full_name || profile?.email || '?').slice(0, 1).toUpperCase()}
      </div>
      <NavLink to="/me" onClick={() => setOpen(false)} className="min-w-0 flex-1 rounded-lg hover:opacity-80" title="บัญชีของฉัน">
        <p className="truncate text-sm font-medium text-slate-900">{profile?.full_name || profile?.email}</p>
        <p className="text-xs text-slate-500">{profile?.role ? ROLE_LABEL[profile.role] : ''} · บัญชีของฉัน</p>
      </NavLink>
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
        <Link to={roleHome(profile?.role)} className="mb-6 px-2">
          <Logo />
          <p className="mt-2 text-xs font-medium tracking-wide text-slate-400">CONTRACTOR TIMESHEET</p>
        </Link>
        <div className="flex-1">{links}</div>
        {me}
      </aside>

      <header className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <Link to={roleHome(profile?.role)}>
          <Logo className="h-7" />
        </Link>
        <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="เมนูทั้งหมด">
          <Menu className="size-5" />
        </button>
      </header>

      {open && (
        <div className="no-print fixed inset-0 z-50 bg-slate-900/40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="ml-auto flex h-full w-72 flex-col bg-white p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-6 flex items-center justify-between">
              <Logo className="h-7" />
              <button onClick={() => setOpen(false)} className="rounded-lg p-2 hover:bg-slate-100" aria-label="ปิดเมนู">
                <X className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{links}</div>
            {me}
          </div>
        </div>
      )}

      <ChangePassword open={pwOpen} onClose={() => setPwOpen(false)} />

      <main className="mx-auto max-w-7xl px-4 pt-6 pb-28 sm:px-6 lg:px-8 lg:py-8">
        <Suspense fallback={<Spinner />}>
          <Outlet />
        </Suspense>
      </main>

      {/* แถบเมนูล่างบนมือถือ: กดครั้งเดียวไปหน้าที่ใช้บ่อย */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5">
          {bottom.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => cx('relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive ? 'text-brand-700' : 'text-slate-500')}
            >
              <n.icon className="size-6" />
              {n.short ?? n.label}
              {badge(n.to, true)}
            </NavLink>
          ))}
          <button onClick={() => setOpen(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-slate-500">
            <Menu className="size-6" />
            เมนู
          </button>
        </div>
      </nav>
    </div>
  )
}

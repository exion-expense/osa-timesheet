import { ArrowLeft, CheckCircle2, Delete, LogIn, LogOut, Search, UserRound } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Logo } from '../components/Layout'
import { cx, Spinner } from '../components/ui'
import { fmtDate, fmtDateLong, fmtOut, fmtTime } from '../lib/format'
import { errMsg, supabase } from '../lib/supabase'

interface TeamInfo {
  ok: boolean
  error?: string
  job_no: string
  job_title: string
  team: string
  today: string
  workers: { id: string; name: string }[]
}
interface Status {
  ok: boolean
  error?: string
  locked?: boolean
  remaining?: number
  name: string
  check_in: string | null
  check_out: string | null
  server_time: string
  work_date?: string
  overnight?: boolean
}

type Step = 'pick' | 'pin' | 'action' | 'done'

export default function Kiosk() {
  const { token = '' } = useParams()
  const storeKey = `osa-kiosk-${token.slice(0, 8)}`
  const [team, setTeam] = useState<TeamInfo | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('pick')
  const [worker, setWorker] = useState<{ id: string; name: string } | null>(null)
  const [pin, setPin] = useState('')
  const [status, setStatus] = useState<Status | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [offset, setOffset] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [result, setResult] = useState<{ action: 'in' | 'out'; at: string } | null>(null)

  useEffect(() => {
    supabase.rpc('kiosk_team', { p_token: token }).then(({ data, error }) => {
      if (error) return setLoadErr(errMsg(error))
      const t = data as TeamInfo
      if (!t.ok) return setLoadErr(t.error ?? 'ใช้งานไม่ได้')
      setTeam(t)
      try {
        const last = localStorage.getItem(storeKey)
        const w = t.workers.find((x) => x.id === last)
        if (w) setWorker(w)
      } catch {
        /* ignore */
      }
    })
  }, [token, storeKey])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // เครื่องเดียวใช้หลายคน: ลงเวลาเสร็จหรือทิ้งไว้ ให้ล้าง PIN และกลับหน้าเลือกชื่อเอง
  useEffect(() => {
    if (step === 'pick') return
    const t = setTimeout(reset, step === 'done' ? 15000 : 60000)
    return () => clearTimeout(t)
  }, [step, pin])

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (team?.workers ?? []).filter((w) => !s || w.name.toLowerCase().includes(s))
  }, [team, q])

  function choose(w: { id: string; name: string }) {
    setWorker(w)
    setPin('')
    setMsg(null)
    setStep('pin')
    try {
      localStorage.setItem(storeKey, w.id)
    } catch {
      /* ignore */
    }
  }

  async function checkPin(p: string) {
    if (!worker) return
    setBusy(true)
    setMsg(null)
    const { data, error } = await supabase.rpc('kiosk_status', { p_token: token, p_worker: worker.id, p_pin: p })
    setBusy(false)
    if (error) {
      setPin('')
      return setMsg(errMsg(error))
    }
    const s = data as Status
    if (!s.ok) {
      setPin('')
      return setMsg(s.error + (s.remaining !== undefined ? ` (เหลืออีก ${s.remaining} ครั้ง)` : ''))
    }
    setOffset(new Date(s.server_time).getTime() - Date.now())
    setStatus(s)
    setStep('action')
  }

  function press(d: string) {
    if (busy) return
    if (d === 'del') return setPin((p) => p.slice(0, -1))
    const next = (pin + d).slice(0, 4)
    setPin(next)
    if (next.length === 4) checkPin(next)
  }

  async function clock(action: 'in' | 'out') {
    if (!worker) return
    setBusy(true)
    setMsg(null)
    const { data, error } = await supabase.rpc('kiosk_clock', { p_token: token, p_worker: worker.id, p_pin: pin, p_action: action })
    setBusy(false)
    if (error) return setMsg(errMsg(error))
    const r = data as { ok: boolean; error?: string; at: string }
    if (!r.ok) return setMsg(r.error ?? 'ไม่สำเร็จ')
    setResult({ action, at: r.at })
    setStep('done')
  }

  function reset() {
    setPin('')
    setStatus(null)
    setResult(null)
    setMsg(null)
    setStep('pick')
  }

  if (loadErr)
    return (
      <Shell>
        <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
          <p className="text-lg font-semibold text-slate-900">ใช้งานไม่ได้</p>
          <p className="mt-2 text-slate-600">{loadErr}</p>
          <p className="mt-4 text-sm text-slate-500">กรุณาสแกน QR จากหัวหน้างานอีกครั้ง</p>
        </div>
      </Shell>
    )
  if (!team) return <Shell><Spinner /></Shell>

  const clockNow = new Date(now + offset)

  return (
    <Shell>
      <div className="mb-4 rounded-2xl bg-brand-600 p-5 text-white shadow-sm">
        <p className="text-sm text-brand-100">
          {team.job_no} · {team.job_title}
        </p>
        <p className="mt-0.5 text-xl font-semibold">{team.team}</p>
        <div className="mt-3 flex items-end justify-between">
          <p className="text-sm text-brand-100">{fmtDateLong(team.today)}</p>
          <p className="tabular text-3xl font-semibold">{fmtTime(clockNow)}</p>
        </div>
      </div>

      {step === 'pick' && (
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="mb-3 text-lg font-semibold text-slate-900">เลือกชื่อของคุณ</p>
          {worker && (
            <button onClick={() => choose(worker)} className="mb-3 flex w-full items-center gap-3 rounded-xl border-2 border-brand-500 bg-brand-50 p-4 text-left">
              <UserRound className="size-6 text-brand-600" />
              <span className="flex-1 text-lg font-medium text-brand-800">{worker.name}</span>
              <span className="text-sm text-brand-600">ใช่ฉัน →</span>
            </button>
          )}
          {team.workers.length > 8 && (
            <div className="relative mb-3">
              <Search className="absolute top-3.5 left-3 size-5 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ค้นหาชื่อ"
                className="w-full rounded-xl border border-slate-300 py-3 pr-3 pl-10 text-base focus:border-brand-500 focus:outline-none"
              />
            </div>
          )}
          <div className="grid gap-2">
            {list.map((w) => (
              <button key={w.id} onClick={() => choose(w)} className="rounded-xl border border-slate-200 px-4 py-3.5 text-left text-base font-medium text-slate-800 active:bg-slate-100">
                {w.name}
              </button>
            ))}
            {list.length === 0 && <p className="py-6 text-center text-slate-500">ไม่พบชื่อ — แจ้งหัวหน้างานให้เพิ่มชื่อ</p>}
          </div>
        </div>
      )}

      {step === 'pin' && worker && (
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <button onClick={reset} className="mb-3 flex items-center gap-1 text-sm text-slate-500">
            <ArrowLeft className="size-4" /> เปลี่ยนชื่อ
          </button>
          <p className="text-center text-lg font-semibold text-slate-900">{worker.name}</p>
          <p className="mt-1 text-center text-sm text-slate-500">กรอกรหัส 4 หลักที่ได้จากหัวหน้างานวันนี้</p>
          <div className="my-5 flex justify-center gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={cx('size-4 rounded-full', i < pin.length ? 'bg-brand-600' : 'bg-slate-200')} />
            ))}
          </div>
          {msg && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-center text-sm text-rose-700">{msg}</p>}
          <div className="mx-auto grid max-w-xs grid-cols-3 gap-3">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k) =>
              k === '' ? (
                <div key="blank" />
              ) : (
                <button
                  key={k}
                  onClick={() => press(k)}
                  disabled={busy}
                  className="flex h-16 items-center justify-center rounded-2xl bg-slate-100 text-2xl font-semibold text-slate-800 active:bg-slate-200 disabled:opacity-50"
                  aria-label={k === 'del' ? 'ลบ' : k}
                >
                  {k === 'del' ? <Delete className="size-6" /> : k}
                </button>
              ),
            )}
          </div>
        </div>
      )}

      {step === 'action' && status && (
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-center text-lg font-semibold text-slate-900">{status.name}</p>
          {status.overnight && status.work_date && (
            <p className="mt-2 rounded-lg bg-indigo-50 px-3 py-2 text-center text-sm text-indigo-800">กะข้ามคืน · ลงเวลาออกของวันที่ {fmtDate(status.work_date)}</p>
          )}
          <div className="my-4 grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-xs text-slate-500">เข้างาน</p>
              <p className="tabular text-xl font-semibold">{status.check_in ? fmtTime(status.check_in) : '—'}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-xs text-slate-500">ออกงาน</p>
              <p className="tabular text-xl font-semibold">{status.check_out && status.check_in ? fmtOut(status.check_in, status.check_out) : '—'}</p>
            </div>
          </div>
          {msg && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-center text-sm text-rose-700">{msg}</p>}
          {!status.check_in && (
            <button onClick={() => clock('in')} disabled={busy} className="flex w-full items-center justify-center gap-3 rounded-2xl bg-emerald-600 py-6 text-2xl font-semibold text-white shadow active:bg-emerald-700 disabled:opacity-60">
              <LogIn className="size-7" /> เช็คอิน เข้างาน
            </button>
          )}
          {status.check_in && !status.check_out && (
            <button onClick={() => clock('out')} disabled={busy} className="flex w-full items-center justify-center gap-3 rounded-2xl bg-orange-500 py-6 text-2xl font-semibold text-white shadow active:bg-orange-600 disabled:opacity-60">
              <LogOut className="size-7" /> เช็คเอาท์ ออกงาน
            </button>
          )}
          {status.check_in && status.check_out && <p className="rounded-xl bg-emerald-50 p-4 text-center text-emerald-700">วันนี้ลงเวลาครบแล้ว</p>}
          <button onClick={reset} className="mt-4 w-full py-2 text-sm text-slate-500">
            ยกเลิก
          </button>
        </div>
      )}

      {step === 'done' && result && (
        <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
          <CheckCircle2 className={cx('mx-auto size-16', result.action === 'in' ? 'text-emerald-500' : 'text-orange-500')} />
          <p className="mt-3 text-lg font-semibold">{result.action === 'in' ? 'เช็คอินสำเร็จ' : 'เช็คเอาท์สำเร็จ'}</p>
          <p className="tabular mt-1 text-5xl font-bold text-slate-900">{fmtTime(result.at)}</p>
          <p className="mt-2 text-slate-500">{worker?.name}</p>
          <button onClick={reset} className="mt-6 w-full rounded-xl bg-slate-900 py-3.5 text-lg font-medium text-white">
            เสร็จสิ้น
          </button>
        </div>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 px-4 pt-5 pb-10">
      <div className="mx-auto max-w-md">
        <div className="mb-4 flex justify-center">
          <Logo className="h-9" />
        </div>
        {children}
        <p className="mt-6 text-center text-xs text-slate-400">
          ระบบบันทึกชื่อและเวลาเข้า-ออกงานเพื่อคิดค่าแรง · <Link to="/privacy" className="underline">ความเป็นส่วนตัว</Link>
        </p>
      </div>
    </div>
  )
}

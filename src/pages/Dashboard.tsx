import { BriefcaseBusiness, CircleDollarSign, ClipboardCheck, Clock, HardHat, Timer } from 'lucide-react'
import { Link } from 'react-router'
import { Card, CardHeader, Empty, ErrorBox, PageHeader, Spinner, Stat } from '../components/ui'
import { useAuth } from '../lib/auth'
import { dayOfMonth, fmtDate, fmtDateLong, fmtMoney, fmtNum } from '../lib/format'
import { must, useLoad } from '../lib/hooks'
import { supabase } from '../lib/supabase'
import { ROLE_LABEL } from '../lib/types'

interface Dash {
  today: string
  active_jobs: number
  on_site: number
  checked_in_today: number
  pending_days_supervisor: number
  pending_days_planner: number
  cost_drafts: number
  cost_waiting: number
  month_hours: { normal: number; ot: number; holiday: number; holiday_ot: number; man_days: number }
  month_cost: { approved: number; submitted: number }
  daily: { d: string; people: number; ot: number }[]
  jobs: { id: string; job_no: string; title: string; contractor_name: string | null; start_date: string; end_date: string; workers: number; today: number; hours: number; approved_cost: number }[]
}

export default function Dashboard() {
  const { profile, is } = useAuth()
  const { data, error, loading, reload } = useLoad(async () => must(await supabase.rpc('dashboard')) as Dash, [])

  if (loading && !data) return <Spinner />
  if (error || !data) return <ErrorBox message={error ?? ''} onRetry={reload} />
  const d = data
  const h = d.month_hours
  const totalH = h.normal + h.ot + h.holiday + h.holiday_ot
  const otShare = totalH ? ((h.ot + h.holiday_ot) / totalH) * 100 : 0
  const myPending = is('supervisor')
    ? d.pending_days_supervisor + d.cost_waiting
    : is('planner')
      ? d.pending_days_planner
      : is('purchase')
        ? d.cost_drafts
        : d.pending_days_supervisor + d.pending_days_planner + d.cost_drafts + d.cost_waiting
  const maxPeople = Math.max(1, ...d.daily.map((x) => x.people))
  const maxJobCost = Math.max(1, ...d.jobs.map((j) => Number(j.approved_cost)))

  return (
    <>
      <PageHeader
        title={`สวัสดี ${profile?.full_name || ''}`}
        sub={`${profile?.role ? ROLE_LABEL[profile.role] : ''} · ${fmtDateLong(d.today)}`}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="อยู่หน้างานตอนนี้" value={fmtNum(d.on_site)} sub={`มาวันนี้ ${d.checked_in_today} คน`} icon={<HardHat className="size-5" />} tone="green" />
        <Link to={is('purchase') ? '/costs' : '/inbox'}>
          <Stat label="งานรอฉัน" value={fmtNum(myPending)} sub="กดเพื่อดูรายการ" icon={<ClipboardCheck className="size-5" />} tone={myPending ? 'amber' : 'gray'} />
        </Link>
        <Stat label="จ็อบที่เปิดอยู่" value={fmtNum(d.active_jobs)} icon={<BriefcaseBusiness className="size-5" />} />
        <Stat
          label="ค่าแรงเดือนนี้ (อนุมัติแล้ว)"
          value={fmtMoney(d.month_cost.approved)}
          sub={d.month_cost.submitted > 0 ? `รออนุมัติอีก ${fmtMoney(d.month_cost.submitted)}` : 'บาท (สุทธิ)'}
          icon={<CircleDollarSign className="size-5" />}
          tone="violet"
        />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="คนเข้างาน 14 วันล่าสุด" sub="จำนวนคนที่ลงเวลาในแต่ละวัน" />
          <div className="flex h-56 items-end gap-1.5 px-5 pt-4 pb-2">
            {d.daily.map((x) => (
              <div key={x.d} className="group flex flex-1 flex-col items-center gap-1">
                <span className="tabular text-xs text-slate-500 opacity-0 group-hover:opacity-100">{x.people}</span>
                <div
                  className="w-full rounded-t-md bg-brand-500 transition group-hover:bg-brand-600"
                  style={{ height: `${(x.people / maxPeople) * 160}px`, minHeight: x.people ? 4 : 0 }}
                  title={`${fmtDate(x.d)}: ${x.people} คน, OT ${fmtNum(x.ot)} ชม.`}
                />
                <span className="tabular text-[11px] text-slate-400">{dayOfMonth(x.d)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="ชั่วโมงเดือนนี้" sub={`${fmtNum(h.man_days)} แรง · ${fmtNum(totalH)} ชม.`} />
          <div className="space-y-4 p-5">
            {[
              { label: 'ปกติ ×1', v: h.normal, c: 'bg-brand-500' },
              { label: 'OT ×1.5', v: h.ot, c: 'bg-amber-500' },
              { label: 'วันหยุด ×2', v: h.holiday, c: 'bg-violet-500' },
              { label: 'OT วันหยุด ×3', v: h.holiday_ot, c: 'bg-rose-500' },
            ].map((r) => (
              <div key={r.label}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="text-slate-600">{r.label}</span>
                  <span className="tabular font-medium">{fmtNum(r.v)} ชม.</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100">
                  <div className={`h-2 rounded-full ${r.c}`} style={{ width: `${totalH ? (r.v / totalH) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
            <p className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
              <Timer className="size-4 text-amber-500" /> สัดส่วน OT {fmtNum(otShare)}% ของชั่วโมงทั้งหมด
            </p>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="จ็อบที่กำลังทำ" />
        {d.jobs.length === 0 ? (
          <Empty icon={<BriefcaseBusiness className="size-6" />} title="ยังไม่มีจ็อบ" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 text-left">จ็อบ</th>
                  <th className="px-3 py-2.5 text-left">ช่วงวันที่</th>
                  <th className="px-3 py-2.5 text-center">คน</th>
                  <th className="px-3 py-2.5 text-center">มาวันนี้</th>
                  <th className="px-3 py-2.5 text-right">ชั่วโมงรวม</th>
                  <th className="px-5 py-2.5 text-left">ค่าแรงอนุมัติแล้ว</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {d.jobs.map((j) => (
                  <tr key={j.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <Link to={`/jobs/${j.id}`} className="font-mono font-semibold text-brand-700 hover:underline">
                        {j.job_no}
                      </Link>
                      <p className="text-slate-600">{j.title}</p>
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      <span className="flex items-center gap-1.5">
                        <Clock className="size-3.5 text-slate-400" /> {fmtDate(j.start_date)} – {fmtDate(j.end_date)}
                      </span>
                    </td>
                    <td className="tabular px-3 py-3 text-center">{j.workers}</td>
                    <td className="tabular px-3 py-3 text-center">{j.today}</td>
                    <td className="tabular px-3 py-3 text-right">{fmtNum(j.hours)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-2 w-24 rounded-full bg-slate-100">
                          <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${(Number(j.approved_cost) / maxJobCost) * 100}%` }} />
                        </div>
                        <span className="tabular">{fmtMoney(j.approved_cost)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}

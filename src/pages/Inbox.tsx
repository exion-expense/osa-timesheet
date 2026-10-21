import { CalendarCheck, ChevronRight, FileSpreadsheet, Inbox as InboxIcon } from 'lucide-react'
import { Link } from 'react-router'
import { Card, CardHeader, Empty, ErrorBox, PageHeader, Spinner } from '../components/ui'
import { useAuth } from '../lib/auth'
import { fmtDate, fmtDateLong, fmtMoney, todayYmd } from '../lib/format'
import { must, useLoad } from '../lib/hooks'
import { CostBadge, DayBadge } from '../lib/status'
import { supabase } from '../lib/supabase'
import type { CostSheet, DaySheet } from '../lib/types'

type CostRow = CostSheet & { jobs: { job_no: string; title: string }; cost_sheet_approvals: { supervisor_id: string }[] }

export default function Inbox() {
  const { is, profile } = useAuth()
  const { data, error, loading, reload } = useLoad(async () => {
    const today = todayYmd()
    const [days, costs] = await Promise.all([
      supabase.from('v_day_sheets').select('*').eq('locked', false).order('work_date').limit(300),
      supabase
        .from('cost_sheets')
        .select('id, job_id, period_from, period_to, status, revision, reject_reason, net_total, submitted_at, created_at, jobs(job_no, title), cost_sheet_approvals(supervisor_id)')
        .neq('status', 'approved')
        .order('created_at'),
    ])
    let d = must(days) as DaySheet[]
    let c = must(costs) as unknown as CostRow[]
    // คัดเฉพาะงานที่ "ถึงตาฉัน"
    if (is('supervisor')) {
      d = d.filter((x) => x.supervisor_id === profile?.id && !x.supervisor_approved_at && (x.work_date < today || x.open_people === 0))
      c = c.filter((x) => x.status === 'submitted' && !x.cost_sheet_approvals.some((a) => a.supervisor_id === profile?.id))
    } else if (is('planner')) {
      d = d.filter((x) => x.supervisor_approved_at && !x.planner_approved_at)
      c = []
    } else if (is('purchase')) {
      d = []
      c = c.filter((x) => x.status === 'draft')
    }
    return { days: d, costs: c }
  }, [profile?.id])

  if (loading && !data) return <Spinner />
  if (error || !data) return <ErrorBox message={error ?? ''} onRetry={reload} />
  const { days, costs } = data

  const hint = is('supervisor')
    ? 'ใบลงเวลาที่รอคุณตรวจ และใบคิดราคาที่รอคุณอนุมัติ'
    : is('planner')
      ? 'ใบลงเวลาที่หัวหน้างานอนุมัติแล้ว รอคุณตรวจและใส่ Allowance'
      : is('purchase')
        ? 'ใบคิดราคาที่ต้องใส่ค่าแรงและส่งอนุมัติ — วันที่อนุมัติครบจะเข้ามาเองอัตโนมัติ'
        : 'ทุกรายการที่ยังไม่เสร็จ'

  return (
    <>
      <PageHeader title="งานรออนุมัติ" sub={hint} />
      <div className="grid gap-6 xl:grid-cols-2">
        {!is('purchase') && (
          <Card>
            <CardHeader title={`ใบลงเวลารายวัน (${days.length})`} />
            {days.length === 0 ? (
              <Empty icon={<CalendarCheck className="size-6" />} title="ไม่มีงานค้าง" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {days.map((d) => (
                  <li key={d.id}>
                    <Link to={`/days/${d.id}`} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-900">{fmtDateLong(d.work_date)}</p>
                        <p className="truncate text-sm text-slate-500">
                          {d.job_no} · {d.team_name} · {d.people} คน
                        </p>
                      </div>
                      <DayBadge d={d} />
                      <ChevronRight className="size-4 text-slate-400" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {!is('planner') && (
          <Card>
            <CardHeader title={`ใบคิดราคา (${costs.length})`} />
            {costs.length === 0 ? (
              <Empty icon={<FileSpreadsheet className="size-6" />} title="ไม่มีงานค้าง" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {costs.map((c) => (
                  <li key={c.id}>
                    <Link to={`/cost/${c.id}`} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-900">
                          {c.jobs.job_no} · {c.jobs.title}
                        </p>
                        <p className="text-sm text-slate-500">
                          {fmtDate(c.period_from)} – {fmtDate(c.period_to)}
                          {c.net_total != null && ` · ${fmtMoney(c.net_total)} ฿`}
                        </p>
                      </div>
                      <CostBadge c={c} />
                      <ChevronRight className="size-4 text-slate-400" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
      {days.length === 0 && costs.length === 0 && (
        <p className="mt-6 flex items-center justify-center gap-2 text-sm text-slate-400">
          <InboxIcon className="size-4" /> เคลียร์งานหมดแล้ว
        </p>
      )}
    </>
  )
}

import { Check, ChevronDown, ChevronRight, Clock, FileSpreadsheet, ListChecks } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Badge, Card, CardHeader, cx, Empty, ErrorBox, Field, Input, PageHeader, Select, Spinner, Stat } from '../components/ui'
import { addDays, fmtDate, fmtDateLong, fmtDateTime, fmtHours, fmtMoney, fmtOut, fmtTime, todayYmd } from '../lib/format'
import { must, useLoad } from '../lib/hooks'
import { CostBadge } from '../lib/status'
import { supabase } from '../lib/supabase'
import type { AttendanceHours, CostSheet, DaySheet } from '../lib/types'

type Sheet = DaySheet & { opened_at: string | null; opened_by: string | null }
type Cost = CostSheet & { jobs: { job_no: string; title: string }; cost_sheet_approvals: { supervisor_id: string; approved_at: string }[] }
type Person = { id: string; full_name: string; email: string }
type JobLite = { id: string; job_no: string; title: string }

type StepState = 'done' | 'waiting' | 'todo'
function StepChip({ state, label, at, by, extra }: { state: StepState; label: string; at?: string | null; by?: string; extra?: string }) {
  return (
    <div
      className={cx(
        'min-w-36 flex-1 rounded-xl border px-3 py-2',
        state === 'done' && 'border-emerald-200 bg-emerald-50',
        state === 'waiting' && 'border-amber-200 bg-amber-50',
        state === 'todo' && 'border-slate-200 bg-slate-50',
      )}
    >
      <p className={cx('flex items-center gap-1 text-xs font-medium', state === 'done' ? 'text-emerald-700' : state === 'waiting' ? 'text-amber-700' : 'text-slate-400')}>
        {state === 'done' ? <Check className="size-3.5" /> : <Clock className="size-3.5" />} {label}
      </p>
      <p className={cx('mt-0.5 text-xs', state === 'todo' ? 'text-slate-400' : 'text-slate-700')}>
        {at ? fmtDateTime(at) : state === 'waiting' ? 'รอดำเนินการ' : '—'}
        {by && <span className="block truncate text-slate-500">{by}</span>}
        {extra && <span className="block text-slate-500">{extra}</span>}
      </p>
    </div>
  )
}

/** หน้าสถานะรวม: ทุกตำแหน่งดูได้ (เห็นเฉพาะจ็อบที่มีสิทธิ์) */
export default function Status() {
  const today = todayYmd()
  const [from, setFrom] = useState(addDays(today, -13))
  const [to, setTo] = useState(today)
  const [jobId, setJobId] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const { data, error, loading, reload } = useLoad(async () => {
    let dq = supabase.from('v_day_sheets').select('*').gte('work_date', from).lte('work_date', to).order('work_date', { ascending: false }).order('job_no').order('team_name')
    let cq = supabase
      .from('cost_sheets')
      .select('id, job_id, period_from, period_to, status, revision, reject_reason, net_total, created_at, submitted_at, submitted_by, approved_at, jobs(job_no, title), cost_sheet_approvals(supervisor_id, approved_at)')
      .lte('period_from', to)
      .gte('period_to', from)
      .order('period_to', { ascending: false })
    if (jobId) {
      dq = dq.eq('job_id', jobId)
      cq = cq.eq('job_id', jobId)
    }
    const [days, costs, people, jobs] = await Promise.all([
      dq,
      cq,
      supabase.from('profiles').select('id, full_name, email'),
      supabase.from('jobs').select('id, job_no, title').order('job_no'),
    ])
    return {
      days: must(days) as Sheet[],
      costs: must(costs) as unknown as Cost[],
      people: must(people) as Person[],
      jobs: must(jobs) as JobLite[],
    }
  }, [from, to, jobId])

  const pn = (id: string | null | undefined) => {
    const p = data?.people.find((x) => x.id === id)
    return p?.full_name || p?.email || ''
  }
  const costFor = (s: Sheet) => data?.costs.find((c) => c.job_id === s.job_id && s.work_date >= c.period_from && s.work_date <= c.period_to)

  const counts = useMemo(() => {
    const c = { sup: 0, planner: 0, pricing: 0, priceApproval: 0, done: 0 }
    for (const s of data?.days ?? []) {
      if (!s.opened_at && s.people === 0) continue
      if (!s.supervisor_approved_at) c.sup++
      else if (!s.planner_approved_at) c.planner++
      else {
        const cs = costFor(s)
        if (!cs || cs.status === 'draft') c.pricing++
        else if (cs.status === 'submitted') c.priceApproval++
        else c.done++
      }
    }
    return c
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  return (
    <>
      <PageHeader title="สถานะงาน" sub="ติดตามทุกขั้นตอน ตั้งแต่เปิดลงเวลาจนถึงอนุมัติราคา พร้อมเวลาและผู้ดำเนินการ" />

      <Card className="mb-6 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="จ็อบ">
            <Select value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">ทุกจ็อบ</option>
              {data?.jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.job_no} · {j.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="ตั้งแต่">
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="ถึง">
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      </Card>

      {loading && !data ? (
        <Spinner />
      ) : error || !data ? (
        <ErrorBox message={error ?? ''} onRetry={reload} />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <Stat label="รอหัวหน้าอนุมัติ" value={counts.sup} tone={counts.sup ? 'amber' : 'gray'} />
            <Stat label="รอ Planner" value={counts.planner} tone={counts.planner ? 'amber' : 'gray'} />
            <Stat label="รอคิดราคา (Purchase)" value={counts.pricing} tone={counts.pricing ? 'amber' : 'gray'} />
            <Stat label="รออนุมัติราคา" value={counts.priceApproval} tone={counts.priceApproval ? 'amber' : 'gray'} />
            <Stat label="เสร็จสมบูรณ์" value={counts.done} tone="green" />
          </div>

          <Card className="mb-6">
            <CardHeader title={`ใบลงเวลารายวัน (${data.days.length})`} sub="กดที่แถวเพื่อดูเวลาเข้า-ออกของแต่ละคน" />
            {data.days.length === 0 ? (
              <Empty icon={<ListChecks className="size-6" />} title="ไม่มีรายการในช่วงนี้" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.days.map((s) => {
                  const cs = costFor(s)
                  const isOpen = open === s.id
                  const pricedState: StepState = !s.planner_approved_at ? 'todo' : cs?.status === 'approved' ? 'done' : 'waiting'
                  return (
                    <li key={s.id}>
                      <button onClick={() => setOpen(isOpen ? null : s.id)} className="w-full px-5 py-4 text-left hover:bg-slate-50">
                        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                          {isOpen ? <ChevronDown className="size-4 text-slate-400" /> : <ChevronRight className="size-4 text-slate-400" />}
                          <span className="font-semibold text-slate-900">{fmtDateLong(s.work_date)}</span>
                          <span className="text-sm text-slate-600">
                            <span className="font-mono text-brand-700">{s.job_no}</span> · {s.team_name}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <StepChip state={s.opened_at ? 'done' : 'waiting'} label="เปิดลงเวลา" at={s.opened_at} by={pn(s.opened_by)} />
                          <StepChip
                            state={s.people > 0 && s.open_people === 0 ? 'done' : s.people > 0 ? 'waiting' : s.opened_at ? 'waiting' : 'todo'}
                            label="ลงเวลาเข้า-ออก"
                            extra={`เข้า ${s.people} คน · ยังไม่ออก ${s.open_people}`}
                          />
                          <StepChip state={s.supervisor_approved_at ? 'done' : s.people > 0 && s.open_people === 0 ? 'waiting' : 'todo'} label="Manager อนุมัติ" at={s.supervisor_approved_at} by={pn(s.supervisor_approved_by)} />
                          <StepChip state={s.planner_approved_at ? 'done' : s.supervisor_approved_at ? 'waiting' : 'todo'} label="Planner อนุมัติ" at={s.planner_approved_at} by={pn(s.planner_approved_by)} />
                          <StepChip
                            state={pricedState}
                            label="คิดราคา"
                            at={cs?.status === 'approved' ? cs.approved_at : cs?.submitted_at}
                            extra={!s.planner_approved_at ? undefined : !cs ? 'ยังไม่มีใบคิดราคา' : cs.status === 'draft' ? 'อยู่ในใบร่าง รอ Purchase' : cs.status === 'submitted' ? 'รอหัวหน้าอนุมัติราคา' : 'อนุมัติราคาแล้ว'}
                          />
                        </div>
                        {s.reject_reason && !s.supervisor_approved_at && <p className="mt-2 text-xs text-rose-600">ถูกตีกลับ: {s.reject_reason}</p>}
                      </button>
                      {isOpen && <DayPeople sheet={s} />}
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title={`ใบคิดราคา (${data.costs.length})`} />
            {data.costs.length === 0 ? (
              <Empty icon={<FileSpreadsheet className="size-6" />} title="ไม่มีใบคิดราคาในช่วงนี้" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.costs.map((c) => (
                  <li key={c.id}>
                    <Link to={`/cost/${c.id}`} className="block px-5 py-4 hover:bg-slate-50">
                      <div className="mb-3 flex flex-wrap items-center gap-3">
                        <span className="font-semibold text-slate-900">
                          <span className="font-mono text-brand-700">{c.jobs.job_no}</span> · {c.jobs.title}
                        </span>
                        <span className="text-sm text-slate-500">
                          {fmtDate(c.period_from)} – {fmtDate(c.period_to)}
                        </span>
                        <CostBadge c={c} />
                        {c.revision > 0 && <Badge tone="blue">Revise {c.revision}</Badge>}
                        {c.net_total != null && <span className="tabular ml-auto font-semibold">{fmtMoney(c.net_total)} ฿</span>}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <StepChip state="done" label="สร้างใบ" at={c.created_at} />
                        <StepChip state={c.submitted_at && c.status !== 'draft' ? 'done' : 'waiting'} label="Purchase ส่ง" at={c.status !== 'draft' ? c.submitted_at : null} by={c.status !== 'draft' ? pn(c.submitted_by) : undefined} />
                        {c.cost_sheet_approvals.map((a) => (
                          <StepChip key={a.supervisor_id} state="done" label="หัวหน้าอนุมัติ" at={a.approved_at} by={pn(a.supervisor_id)} />
                        ))}
                        <StepChip state={c.status === 'approved' ? 'done' : c.status === 'submitted' ? 'waiting' : 'todo'} label="อนุมัติราคาแล้ว" at={c.approved_at} />
                      </div>
                      {c.reject_reason && c.status === 'draft' && <p className="mt-2 text-xs text-rose-600">ถูกตีกลับ: {c.reject_reason}</p>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </>
  )
}

function DayPeople({ sheet }: { sheet: Sheet }) {
  const { data, error } = useLoad(async () => {
    const [rows, workers] = await Promise.all([
      supabase.from('v_attendance_hours').select('*').eq('team_id', sheet.team_id).eq('work_date', sheet.work_date),
      supabase.from('workers').select('id, full_name').eq('job_id', sheet.job_id),
    ])
    const ws = must(workers) as { id: string; full_name: string }[]
    return (must(rows) as AttendanceHours[])
      .map((r) => ({ ...r, name: ws.find((w) => w.id === r.worker_id)?.full_name ?? '' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'th'))
  }, [sheet.id, sheet.people, sheet.open_people])

  if (error) return <div className="px-5 pb-4"><ErrorBox message={error} /></div>
  if (!data) return <Spinner />
  return (
    <div className="px-5 pb-4">
      {data.length === 0 ? (
        <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">ยังไม่มีคนลงเวลา</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">ชื่อ</th>
                <th className="px-3 py-2">เข้า</th>
                <th className="px-3 py-2">ออก</th>
                <th className="px-3 py-2">{data[0]?.holiday ? '×2' : 'ปกติ'}</th>
                <th className="px-3 py-2">{data[0]?.holiday ? 'OT ×3' : 'OT ×1.5'}</th>
                <th className="px-4 py-2 text-left">หมายเหตุ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 font-medium">{r.name}</td>
                  <td className="tabular px-3 py-2 text-center">{fmtTime(r.check_in)}</td>
                  <td className="tabular px-3 py-2 text-center">{r.check_out ? fmtOut(r.check_in, r.check_out) : <Badge tone="amber">ยังไม่ออก</Badge>}</td>
                  <td className="tabular px-3 py-2 text-center">{fmtHours(r.normal_h)}</td>
                  <td className="tabular px-3 py-2 text-center">{fmtHours(r.ot_h)}</td>
                  <td className="px-4 py-2 text-xs text-amber-700">{r.source === 'supervisor' ? `แก้โดยหัวหน้า${r.note ? `: ${r.note}` : ''}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Link to={`/days/${sheet.id}`} className="mt-2 inline-block text-sm text-brand-600 hover:underline">
        เปิดใบลงเวลา →
      </Link>
    </div>
  )
}

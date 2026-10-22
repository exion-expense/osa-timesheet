import { ChevronRight, FileSpreadsheet } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Badge, Card, Empty, ErrorBox, PageHeader, Spinner, Tabs } from '../components/ui'
import { useAuth } from '../lib/auth'
import { fmtDate, fmtMoney } from '../lib/format'
import { must, useLoad } from '../lib/hooks'
import { CostBadge } from '../lib/status'
import { supabase } from '../lib/supabase'
import type { CostSheet } from '../lib/types'

type Row = CostSheet & { jobs: { job_no: string; title: string; contractor_name: string | null; terms_confirmed_at: string | null } }
type Day = { job_id: string; work_date: string; locked: boolean }
type Tab = 'draft' | 'submitted' | 'approved'

/** หน้าคิดราคา: วันที่อนุมัติครบไหลเข้าใบร่างของแต่ละจ็อบอัตโนมัติ */
export default function Costs() {
  const { is } = useAuth()
  const [tab, setTab] = useState<Tab>(is('manager') ? 'submitted' : 'draft')
  const { data, error, loading, reload } = useLoad(async () => {
    const [cs, days] = await Promise.all([
      supabase
        .from('cost_sheets')
        .select('id, job_id, period_from, period_to, status, revision, reject_reason, net_total, submitted_at, approved_at, created_at, jobs(job_no, title, contractor_name, terms_confirmed_at)')
        .order('period_to', { ascending: false }),
      supabase.from('v_day_sheets').select('job_id, work_date, locked'),
    ])
    return { sheets: must(cs) as unknown as Row[], days: must(days) as Day[] }
  }, [])

  const rows = useMemo(() => (data?.sheets ?? []).filter((s) => s.status === tab), [data, tab])
  const count = (t: Tab) => (data?.sheets ?? []).filter((s) => s.status === t).length

  const dayStats = (s: Row) => {
    const inPeriod = (data?.days ?? []).filter((d) => d.job_id === s.job_id && d.work_date >= s.period_from && d.work_date <= s.period_to)
    const dates = new Set(inPeriod.filter((d) => d.locked).map((d) => d.work_date))
    return { approved: dates.size, pending: inPeriod.filter((d) => !d.locked).length }
  }

  return (
    <>
      <PageHeader
        title="คิดราคา"
        sub="เมื่อหัวหน้างานและ Planner อนุมัติวันไหนครบ วันนั้นจะเข้ามาอยู่ในใบคิดราคา (ร่าง) ของจ็อบนั้นเอง ใส่ค่าแรงแล้วส่งให้ Manager อนุมัติได้เลย"
      />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'draft', label: `ต้องทำ (${count('draft')})` },
          { value: 'submitted', label: `รอ Manager อนุมัติ (${count('submitted')})` },
          { value: 'approved', label: `อนุมัติแล้ว (${count('approved')})` },
        ]}
      />
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : rows.length === 0 ? (
        <Card>
          <Empty
            icon={<FileSpreadsheet className="size-6" />}
            title={tab === 'draft' ? 'ยังไม่มีวันที่อนุมัติครบ' : 'ไม่มีรายการ'}
            sub={tab === 'draft' ? 'ใบคิดราคาจะขึ้นที่นี่อัตโนมัติ เมื่อ Planner อนุมัติใบลงเวลารายวัน' : undefined}
          />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {rows.map((s) => {
              const st = dayStats(s)
              return (
                <li key={s.id}>
                  <Link to={`/cost/${s.id}`} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4 hover:bg-slate-50">
                    <div className="min-w-56 flex-1">
                      <p className="font-medium text-slate-900">
                        <span className="font-mono text-brand-700">{s.jobs.job_no}</span> · {s.jobs.title}
                      </p>
                      <p className="text-sm text-slate-500">
                        {fmtDate(s.period_from)} – {fmtDate(s.period_to)}
                        {s.jobs.contractor_name && ` · ${s.jobs.contractor_name}`}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="green">อนุมัติแล้ว {st.approved} วัน</Badge>
                      {s.status === 'draft' && st.pending > 0 && <Badge tone="amber">รออนุมัติ {st.pending} ใบ</Badge>}
                      {s.status === 'draft' && !s.jobs.terms_confirmed_at && <Badge tone="amber">ยังไม่ยืนยันเงื่อนไข</Badge>}
                    </div>
                    {s.net_total != null && <p className="tabular w-32 text-right font-semibold text-slate-900">{fmtMoney(s.net_total)} ฿</p>}
                    <CostBadge c={s} />
                    <ChevronRight className="size-4 text-slate-400" />
                  </Link>
                </li>
              )
            })}
          </ul>
        </Card>
      )}
    </>
  )
}

import { BriefcaseBusiness, CalendarRange, Plus, Search, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Badge, Button, Card, Empty, ErrorBox, Input, PageHeader, Spinner, Tabs } from '../components/ui'
import { useAuth } from '../lib/auth'
import { fmtDate, todayYmd } from '../lib/format'
import { must, useLoad } from '../lib/hooks'
import { supabase } from '../lib/supabase'
import type { Job } from '../lib/types'

type JobRow = Job & { teams: { id: string; name: string }[]; workers: { count: number }[] }

export default function Jobs() {
  const { is } = useAuth()
  const [tab, setTab] = useState<'active' | 'closed'>('active')
  const [q, setQ] = useState('')
  const { data, error, loading, reload } = useLoad(
    async () =>
      must(
        await supabase
          .from('jobs')
          .select('*, teams(id, name), workers(count)')
          .order('start_date', { ascending: false }),
      ) as JobRow[],
    [],
  )

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (data ?? [])
      .filter((j) => j.status === tab)
      .filter((j) => !s || [j.job_no, j.title, j.contractor_name, j.location].some((v) => v?.toLowerCase().includes(s)))
  }, [data, tab, q])

  const today = todayYmd()

  return (
    <>
      <PageHeader
        title="จ็อบ"
        sub="งานผู้รับเหมาทั้งหมดที่คุณดูแล"
        right={
          is('admin') && (
            <Link to="/jobs/new">
              <Button>
                <Plus className="size-4" /> เพิ่มจ็อบ
              </Button>
            </Link>
          )
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'active', label: 'กำลังทำ' },
            { value: 'closed', label: 'ปิดแล้ว' },
          ]}
        />
        <div className="relative mb-5 w-full sm:w-72">
          <Search className="absolute top-2.5 left-3 size-4 text-slate-400" />
          <Input className="pl-9" placeholder="ค้นหาเลขจ็อบ / ลูกค้า / ผู้รับเหมา" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : rows.length === 0 ? (
        <Card>
          <Empty icon={<BriefcaseBusiness className="size-6" />} title="ยังไม่มีจ็อบ" sub={is('admin') ? 'กด "เพิ่มจ็อบ" เพื่อเริ่ม' : 'แอดมินจะเพิ่มจ็อบและกำหนดทีมให้คุณ'} />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((j) => {
            const live = j.status === 'active' && today >= j.start_date && today <= j.end_date
            return (
              <Link key={j.id} to={`/jobs/${j.id}`}>
                <Card className="h-full p-5 transition hover:border-brand-300 hover:shadow-md">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-sm font-semibold text-brand-700">{j.job_no}</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">{j.title}</p>
                      {j.contractor_name && <p className="text-sm text-slate-500">{j.contractor_name}</p>}
                    </div>
                    {live ? <Badge tone="green">เปิดลงเวลา</Badge> : j.status === 'closed' ? <Badge>ปิดแล้ว</Badge> : <Badge tone="amber">นอกช่วงวันที่</Badge>}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600">
                    <span className="flex items-center gap-1.5">
                      <CalendarRange className="size-4 text-slate-400" />
                      {fmtDate(j.start_date)} – {fmtDate(j.end_date)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Users className="size-4 text-slate-400" />
                      {j.teams.length} ทีม · {j.workers[0]?.count ?? 0} คน
                    </span>
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </>
  )
}

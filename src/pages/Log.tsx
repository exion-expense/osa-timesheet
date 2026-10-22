import { FileSpreadsheet, ScrollText, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Badge, Button, Card, cx, Empty, ErrorBox, Field, Input, PageHeader, Select, Spinner } from '../components/ui'
import { downloadCsv } from '../lib/csv'
import { addDays, fmtDate, fmtHours, fmtOut, fmtTime, todayYmd } from '../lib/format'
import { must, useLoad } from '../lib/hooks'
import { supabase } from '../lib/supabase'
import type { AttendanceHours } from '../lib/types'

type JobLite = { id: string; job_no: string; title: string }
type TeamLite = { id: string; name: string }
type WorkerLite = { id: string; full_name: string }

/** บันทึกเข้า-ออก: ดูชื่อ เวลาเข้า เวลาออก เลขจ็อบ นับจำนวนคน — กรองตามวันที่ จ็อบ และชื่อ */
export default function Log() {
  const today = todayYmd()
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [jobId, setJobId] = useState('')
  const [q, setQ] = useState('')

  const jobs = useLoad(async () => must(await supabase.from('jobs').select('id, job_no, title').order('job_no')) as JobLite[], [])

  const { data, error, loading, reload } = useLoad(async () => {
    let query = supabase.from('v_attendance_hours').select('*').gte('work_date', from).lte('work_date', to).order('work_date', { ascending: false }).order('check_in').limit(3000)
    if (jobId) query = query.eq('job_id', jobId)
    const rows = must(await query) as AttendanceHours[]
    const wIds = [...new Set(rows.map((r) => r.worker_id))]
    const tIds = [...new Set(rows.map((r) => r.team_id))]
    const [workers, teams] = await Promise.all([
      wIds.length ? supabase.from('workers').select('id, full_name').in('id', wIds) : Promise.resolve({ data: [], error: null }),
      tIds.length ? supabase.from('teams').select('id, name').in('id', tIds) : Promise.resolve({ data: [], error: null }),
    ])
    return {
      rows,
      workers: new Map((must(workers) as WorkerLite[]).map((w) => [w.id, w.full_name])),
      teams: new Map((must(teams) as TeamLite[]).map((t) => [t.id, t.name])),
    }
  }, [from, to, jobId])

  const jobMap = useMemo(() => new Map((jobs.data ?? []).map((j) => [j.id, j])), [jobs.data])
  const rows = useMemo(() => {
    if (!data) return []
    const s = q.trim().toLowerCase()
    return data.rows.filter((r) => !s || (data.workers.get(r.worker_id) ?? '').toLowerCase().includes(s))
  }, [data, q])

  const people = new Set(rows.map((r) => r.worker_id)).size
  const stillIn = rows.filter((r) => !r.check_out).length
  const edited = rows.filter((r) => r.edit_count > 0).length
  const hours = rows.reduce((s, r) => s + Number(r.normal_h) + Number(r.ot_h), 0)

  function preset(days: number | 'month') {
    if (days === 'month') {
      setFrom(`${today.slice(0, 8)}01`)
      setTo(today)
    } else {
      setFrom(addDays(today, -days))
      setTo(days === 1 ? addDays(today, -1) : today)
    }
  }

  function exportCsv() {
    if (!data) return
    downloadCsv(`บันทึกเข้าออก-${from}-${to}.csv`, [
      ['วันที่', 'เลขจ็อบ', 'ทีม', 'ชื่อ', 'เวลาเข้า', 'เวลาออก', 'ชม.ปกติ', 'ชม.OT', 'วันหยุด', 'แก้ไข (ครั้ง)', 'หมายเหตุ'],
      ...rows.map((r) => [
        r.work_date,
        jobMap.get(r.job_id)?.job_no ?? '',
        data.teams.get(r.team_id) ?? '',
        data.workers.get(r.worker_id) ?? '',
        fmtTime(r.check_in),
        r.check_out ? fmtOut(r.check_in, r.check_out) : 'ยังไม่ออก',
        Number(r.normal_h),
        Number(r.ot_h),
        r.holiday ? 'ใช่' : '',
        r.edit_count || '',
        r.note ?? '',
      ]),
    ])
  }

  return (
    <>
      <PageHeader
        title="บันทึกเข้า-ออก"
        sub="รายชื่อและเวลาเข้า-ออกทุกจ็อบที่คุณเห็นได้"
        right={
          <Button variant="secondary" onClick={exportCsv} disabled={!rows.length}>
            <FileSpreadsheet className="size-4" /> Export Excel (CSV)
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="ตั้งแต่วันที่">
            <Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </Field>
          <Field label="ถึงวันที่">
            <Input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </Field>
          <Field label="เลขจ็อบ">
            <Select value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">ทุกจ็อบ</option>
              {(jobs.data ?? []).map((j) => (
                <option key={j.id} value={j.id}>
                  {j.job_no} · {j.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="ค้นหาชื่อ">
            <div className="relative">
              <Search className="absolute top-2.5 left-3 size-4 text-slate-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="พิมพ์ชื่อ" className="pl-9" />
            </div>
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {[
            { t: 'วันนี้', f: () => (setFrom(today), setTo(today)) },
            { t: 'เมื่อวาน', f: () => preset(1) },
            { t: '7 วันล่าสุด', f: () => preset(6) },
            { t: 'เดือนนี้', f: () => preset('month') },
          ].map((p) => (
            <button key={p.t} onClick={p.f} className="rounded-full border border-slate-200 px-3 py-1 text-slate-600 hover:bg-slate-50">
              {p.t}
            </button>
          ))}
        </div>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Summary label="รายการ" value={rows.length} />
        <Summary label="รายชื่อ (ไม่ซ้ำ)" value={people} tone="blue" />
        <Summary label="ยังไม่ออก" value={stillIn} tone={stillIn ? 'amber' : 'gray'} />
        <Summary label="ถูกแก้ไข" value={edited} tone={edited ? 'red' : 'gray'} sub={`รวม ${fmtHours(hours) || '0'} ชม.`} />
      </div>

      <Card>
        {loading && !data ? (
          <Spinner />
        ) : error || !data ? (
          <ErrorBox message={error ?? ''} onRetry={reload} />
        ) : rows.length === 0 ? (
          <Empty icon={<ScrollText className="size-6" />} title="ไม่มีการลงเวลาในช่วงนี้" sub="ลองเปลี่ยนวันที่หรือเลขจ็อบ" />
        ) : (
          <>
            {/* มือถือ */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {rows.map((r) => (
                <li key={r.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">{data.workers.get(r.worker_id) ?? '…'}</p>
                      <p className="text-xs text-slate-500">
                        {fmtDate(r.work_date)} · <span className="font-mono">{jobMap.get(r.job_id)?.job_no}</span> · {data.teams.get(r.team_id)}
                      </p>
                    </div>
                    <p className={cx('tabular shrink-0 text-sm', r.edit_count > 0 ? 'font-semibold text-rose-600' : 'text-slate-700')}>
                      {fmtTime(r.check_in)} → {r.check_out ? fmtOut(r.check_in, r.check_out) : <span className="text-amber-700">ยังไม่ออก</span>}
                    </p>
                  </div>
                  {r.edit_count > 0 && <p className="mt-1 text-xs text-rose-600">แก้ไขครั้งที่ {r.edit_count}{r.note ? `: ${r.note}` : ''}</p>}
                </li>
              ))}
            </ul>
            {/* จอใหญ่ */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 text-left">วันที่</th>
                    <th className="px-3 py-2.5 text-left">เลขจ็อบ</th>
                    <th className="px-3 py-2.5 text-left">ทีม</th>
                    <th className="px-3 py-2.5 text-left">ชื่อ</th>
                    <th className="px-3 py-2.5">เข้า</th>
                    <th className="px-3 py-2.5">ออก</th>
                    <th className="px-3 py-2.5">ปกติ</th>
                    <th className="px-3 py-2.5">OT</th>
                    <th className="px-4 py-2.5 text-left">หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {fmtDate(r.work_date)}
                        {r.holiday && <Badge tone="violet">หยุด</Badge>}
                      </td>
                      <td className="px-3 py-2.5">
                        <Link to={`/jobs/${r.job_id}`} className="font-mono text-brand-700 hover:underline">
                          {jobMap.get(r.job_id)?.job_no ?? '…'}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{data.teams.get(r.team_id)}</td>
                      <td className="px-3 py-2.5 font-medium text-slate-900">{data.workers.get(r.worker_id) ?? '…'}</td>
                      <td className={cx('tabular px-3 py-2.5 text-center', r.edit_count > 0 && 'font-semibold text-rose-600')}>{fmtTime(r.check_in)}</td>
                      <td className={cx('tabular px-3 py-2.5 text-center whitespace-nowrap', r.edit_count > 0 && 'font-semibold text-rose-600')}>
                        {r.check_out ? fmtOut(r.check_in, r.check_out) : <Badge tone="amber">ยังไม่ออก</Badge>}
                      </td>
                      <td className="tabular px-3 py-2.5 text-center">{fmtHours(r.normal_h)}</td>
                      <td className="tabular px-3 py-2.5 text-center text-brand-700">{fmtHours(r.ot_h)}</td>
                      <td className="px-4 py-2.5 text-xs text-rose-600">{r.edit_count > 0 ? `แก้ไขครั้งที่ ${r.edit_count}${r.note ? `: ${r.note}` : ''}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </>
  )
}

function Summary({ label, value, sub, tone = 'gray' }: { label: string; value: number; sub?: string; tone?: 'gray' | 'blue' | 'amber' | 'red' }) {
  const c = { gray: 'text-slate-900', blue: 'text-brand-700', amber: 'text-amber-700', red: 'text-rose-600' }[tone]
  return (
    <Card className="p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={cx('tabular text-2xl font-semibold', c)}>{value.toLocaleString('th-TH')}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </Card>
  )
}

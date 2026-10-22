import { useParams } from 'react-router'
import { ErrorBox, Spinner } from '../components/ui'
import { fmtDocDate, fmtHours, fmtOut, fmtTime } from '../lib/format'
import { must, useLoad } from '../lib/hooks'
import { supabase } from '../lib/supabase'
import type { AttendanceHours, DaySheet } from '../lib/types'
import { DocHeader, DraftMark, loadSigs, Paper, PrintShell, SignBox } from './common'

export async function loadDay(id: string) {
    const sheet = must(await supabase.from('v_day_sheets').select('*').eq('id', id).single()) as DaySheet
    const [rows, workers, people, settings, sigs] = await Promise.all([
      supabase.from('v_attendance_hours').select('*').eq('team_id', sheet.team_id).eq('work_date', sheet.work_date),
      supabase.from('workers').select('id, full_name').eq('job_id', sheet.job_id),
      supabase.from('profiles').select('id, full_name, email'),
      supabase.from('app_settings').select('company_name').eq('id', 1).maybeSingle(),
      loadSigs([sheet.supervisor_sig_id, sheet.planner_sig_id]),
    ])
    return {
      sheet,
      rows: must(rows) as AttendanceHours[],
      workers: must(workers) as { id: string; full_name: string }[],
      people: must(people) as { id: string; full_name: string; email: string }[],
      sigs,
      company: (must(settings) as { company_name: string } | null)?.company_name ?? 'OSA Valve Services (Thailand) Co., Ltd.',
    }
}

export default function PrintDay() {
  const { id = '' } = useParams()
  const { data, error } = useLoad(() => loadDay(id), [id])
  if (error) return <ErrorBox message={error} />
  if (!data) return <Spinner />
  return (
    <PrintShell title={`รายชื่อทีมงาน ${data.sheet.job_no} ${fmtDocDate(data.sheet.work_date)}`}>
      <DayDoc data={data} />
    </PrintShell>
  )
}

export function DayDoc({ data }: { data: Awaited<ReturnType<typeof loadDay>> }) {
  const { sheet, rows, workers, people, company, sigs } = data
  const nm = (w: string) => workers.find((x) => x.id === w)?.full_name ?? ''
  const pn = (u: string | null) => people.find((p) => p.id === u)?.full_name || people.find((p) => p.id === u)?.email || ''
  const sorted = [...rows].sort((a, b) => nm(a.worker_id).localeCompare(nm(b.worker_id), 'th'))
  const holiday = rows[0]?.holiday
  const blank = Math.max(0, 15 - sorted.length)

  return (
      <Paper className="mx-auto">
        <DraftMark show={!sheet.locked} />
        <DocHeader company={company} />
        <div className="mb-3 flex items-end justify-between">
          <h1 className="text-2xl font-bold">รายชื่อทีมงาน</h1>
          <p className="text-sm">
            Date : <b>{fmtDocDate(sheet.work_date)}</b> {holiday && '(วันหยุด)'}
          </p>
        </div>
        <p className="mb-3 text-sm">
          Job No. <b className="mx-2">{sheet.job_no}</b> {sheet.job_title} · {sheet.team_name}
        </p>
        <table className="text-[11px]">
          <thead>
            <tr className="bg-slate-100">
              <th rowSpan={2} className="w-8">No.</th>
              <th rowSpan={2}>Name</th>
              <th rowSpan={2} className="w-16">Time in</th>
              <th rowSpan={2} className="w-16">Time Out</th>
              <th rowSpan={2} className="w-12">Normal</th>
              <th colSpan={3}>OT</th>
              <th rowSpan={2} className="w-40">Remark</th>
            </tr>
            <tr className="bg-slate-100">
              <th className="w-10">x1.5</th>
              <th className="w-10">x2</th>
              <th className="w-10">x3</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.id} className="h-7">
                <td className="text-center">{i + 1}</td>
                <td>{nm(r.worker_id)}</td>
                <td className="text-center">{fmtTime(r.check_in)}</td>
                <td className="text-center">{fmtOut(r.check_in, r.check_out)}</td>
                <td className="text-center">{holiday ? '' : fmtHours(r.normal_h)}</td>
                <td className="text-center">{holiday ? '' : fmtHours(r.ot_h)}</td>
                <td className="text-center">{holiday ? fmtHours(r.normal_h) : ''}</td>
                <td className="text-center">{holiday ? fmtHours(r.ot_h) : ''}</td>
                <td className="text-[9px]">{r.source === 'supervisor' ? `แก้โดยหัวหน้า: ${r.note ?? ''}` : ''}</td>
              </tr>
            ))}
            {Array.from({ length: blank }).map((_, i) => (
              <tr key={`b${i}`} className="h-7">
                <td className="text-center">{sorted.length + i + 1}</td>
                {Array.from({ length: 8 }).map((__, j) => (
                  <td key={j} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[9px] text-slate-600">เวลาบันทึกจากระบบ (เวลาเซิร์ฟเวอร์) · ชั่วโมงปกติไม่เกิน 8 ชม./วัน ส่วนเกินเป็น OT</p>
        <div className="mt-8 flex gap-4">
          <SignBox
            label="Prepared By (หัวหน้างาน)"
            name={sheet.supervisor_name || pn(sheet.supervisor_approved_by)}
            signature={sheet.supervisor_sig_id ? sigs.get(sheet.supervisor_sig_id) : null}
            date={sheet.supervisor_approved_at ? fmtDocDate(sheet.supervisor_approved_at) : ''}
            note={sheet.supervisor_approved_at ? 'อนุมัติในระบบ' : undefined}
          />
          <SignBox
            label="Approved By (Planner)"
            name={sheet.planner_name || pn(sheet.planner_approved_by)}
            signature={sheet.planner_sig_id ? sigs.get(sheet.planner_sig_id) : null}
            date={sheet.planner_approved_at ? fmtDocDate(sheet.planner_approved_at) : ''}
            note={sheet.planner_approved_at ? 'อนุมัติในระบบ' : undefined}
          />
        </div>
      </Paper>
  )
}

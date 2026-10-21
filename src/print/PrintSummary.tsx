import { useParams } from 'react-router'
import { ErrorBox, Spinner } from '../components/ui'
import { bahtText, fmtDocDate, fmtHours, fmtMoney, fmtNum } from '../lib/format'
import { useLoad } from '../lib/hooks'
import { DocHeader, DraftMark, loadCost, Paper, PrintShell, SignBox } from './common'

export default function PrintSummary() {
  const { id = '' } = useParams()
  const { data, error } = useLoad(() => loadCost(id), [id])
  if (error) return <ErrorBox message={error} />
  if (!data) return <Spinner />
  return (
    <PrintShell title={`สรุปค่าแรง ${data.snap.job.job_no}`}>
      <SummaryDoc data={data} />
    </PrintShell>
  )
}

export function SummaryDoc({ data }: { data: Awaited<ReturnType<typeof loadCost>> }) {
  const { cs, snap, name, supervisors } = data
  const sum = (k: 'n1' | 'ot15' | 'h2' | 'h3') => snap.workers.reduce((s, w) => s + w.hours[k], 0)
  const allowTotal = snap.workers.reduce((s, w) => s + w.allowance_total, 0)

  return (
      <Paper className="mx-auto">
        <DraftMark show={cs.status !== 'approved'} />
        <DocHeader
          company={snap.settings.company}
          right={cs.revision > 0 ? <p className="text-base font-bold text-rose-600">REVISE {cs.revision}</p> : undefined}
        />
        <h1 className="mt-2 mb-4 border-b-2 border-black pb-2 text-center text-xl font-bold">สรุปค่าแรงผู้รับเหมา</h1>

        <table className="noborder mb-4 text-[12px]">
          <tbody>
            <tr>
              <td className="w-28 font-semibold">Job</td>
              <td>
                {snap.job.job_no} &nbsp; {snap.job.title}
              </td>
              <td className="w-24 font-semibold">วันที่พิมพ์</td>
              <td className="w-28">{fmtDocDate(new Date())}</td>
            </tr>
            <tr>
              <td className="font-semibold">ผู้รับเหมา</td>
              <td>{snap.job.contractor || '-'}</td>
              <td className="font-semibold">จำนวนคน</td>
              <td>{snap.workers.length} คน</td>
            </tr>
            <tr>
              <td className="font-semibold">ช่วงวันที่</td>
              <td>
                {fmtDocDate(snap.period.from)} – {fmtDocDate(snap.period.to)}
              </td>
              <td className="font-semibold">แรงงานรวม</td>
              <td>{snap.workers.reduce((s, w) => s + w.work_days, 0)} แรง</td>
            </tr>
          </tbody>
        </table>

        <table className="text-[10.5px]">
          <thead>
            <tr className="bg-slate-200">
              <th className="w-7">No</th>
              <th>ชื่อ-นามสกุล</th>
              <th className="w-14">ค่าแรง/วัน</th>
              <th className="w-9">วัน</th>
              <th className="w-11">ปกติ</th>
              <th className="w-11">x1.5</th>
              <th className="w-11">x2</th>
              <th className="w-11">x3</th>
              <th className="w-16">Allowance</th>
              <th className="w-20">จำนวนเงิน</th>
            </tr>
          </thead>
          <tbody>
            {snap.workers.map((w, i) => (
              <tr key={w.worker_id} style={{ breakInside: 'avoid' }}>
                <td className="text-center">{i + 1}</td>
                <td>
                  {w.name} <span className="text-[9px] text-slate-600">({w.position})</span>
                </td>
                <td className="text-right">{fmtMoney(w.day_rate)}</td>
                <td className="text-center">{w.work_days}</td>
                <td className="text-center">{fmtHours(w.hours.n1)}</td>
                <td className="text-center">{fmtHours(w.hours.ot15)}</td>
                <td className="text-center">{fmtHours(w.hours.h2)}</td>
                <td className="text-center">{fmtHours(w.hours.h3)}</td>
                <td className="text-right">{w.allowance_total ? fmtMoney(w.allowance_total) : ''}</td>
                <td className="text-right">{fmtMoney(w.total)}</td>
              </tr>
            ))}
            <tr className="bg-slate-100 font-semibold">
              <td colSpan={4} className="text-center">
                รวมชั่วโมง
              </td>
              <td className="text-center">{fmtNum(sum('n1'))}</td>
              <td className="text-center">{fmtNum(sum('ot15'))}</td>
              <td className="text-center">{fmtNum(sum('h2'))}</td>
              <td className="text-center">{fmtNum(sum('h3'))}</td>
              <td className="text-right">{allowTotal ? fmtMoney(allowTotal) : ''}</td>
              <td className="text-right">{fmtMoney(snap.subtotal)}</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-4 flex justify-end" style={{ breakInside: 'avoid' }}>
          <table className="w-80 text-[12px]">
            <tbody>
              <tr>
                <td className="font-semibold">สรุปค่าแรง</td>
                <td className="w-32 text-right">{fmtMoney(snap.subtotal)}</td>
              </tr>
              <tr>
                <td className="font-semibold">หัก ณ ที่จ่าย {fmtNum(snap.settings.wht_rate)}%</td>
                <td className="text-right">({fmtMoney(snap.wht)})</td>
              </tr>
              <tr className="bg-slate-200 text-[13px] font-bold">
                <td>ยอดจ่ายสุทธิ</td>
                <td className="text-right">{fmtMoney(snap.net)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-right text-[11px] font-semibold">**{bahtText(snap.net)}**</p>

        <div className="mt-10 flex gap-3" style={{ breakInside: 'avoid' }}>
          <SignBox label="ผู้จัดทำ / Prepared by (Purchase)" name={name(cs.submitted_by)} date={cs.submitted_at ? fmtDocDate(cs.submitted_at) : ''} note={cs.submitted_at ? 'ส่งในระบบ' : undefined} />
          {supervisors.map((s) => (
            <SignBox key={s.id} label="ผู้ตรวจสอบ / Checked by (หัวหน้างาน)" name={s.name} date={s.at ? fmtDocDate(s.at) : ''} note={s.at ? 'อนุมัติในระบบ' : undefined} />
          ))}
          <SignBox label="ผู้อนุมัติ / Approved by" />
        </div>
        <p className="mt-6 text-[9px] text-slate-500">
          เอกสารสร้างจากระบบ OSA Timesheet · เลขอ้างอิง {cs.id.slice(0, 8).toUpperCase()}
          {cs.revision > 0 && ` · Revise ${cs.revision}`} · แนบ Time Sheet ประกอบ
        </p>
      </Paper>
  )
}

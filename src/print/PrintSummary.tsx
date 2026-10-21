import { useParams } from 'react-router'
import { ErrorBox, Spinner } from '../components/ui'
import { fmtMoney, fmtNum } from '../lib/format'
import { useLoad } from '../lib/hooks'
import { DraftMark, loadCost, Paper, PrintShell } from './common'

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

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** ช่วงวันที่แบบในเอกสารตัวอย่าง เช่น 1-11 Sep 2026 */
function periodText(from: string, to: string) {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  if (from === to) return `${fd} ${MON[fm - 1]} ${fy}`
  if (fy === ty && fm === tm) return `${fd}-${td} ${MON[tm - 1]} ${ty}`
  if (fy === ty) return `${fd} ${MON[fm - 1]} - ${td} ${MON[tm - 1]} ${ty}`
  return `${fd} ${MON[fm - 1]} ${fy} - ${td} ${MON[tm - 1]} ${ty}`
}

/** สรุปค่าแรง — รูปแบบเดียวกับเอกสารตัวอย่างของบริษัท (หน้าสั้น ไม่มีช่องเซ็น) */
export function SummaryDoc({ data }: { data: Awaited<ReturnType<typeof loadCost>> }) {
  const { cs, snap } = data
  return (
    <Paper className="mx-auto">
      <DraftMark show={cs.status !== 'approved'} />
      <div className="mx-auto mt-[22mm] w-[150mm] text-[15px]" style={{ fontFamily: '"IBM Plex Sans Thai", "Times New Roman", serif' }}>
        {cs.revision > 0 && <p className="mb-6 text-right text-lg font-bold text-rose-600">Time Sheet Revise {cs.revision}</p>}
        <div className="grid grid-cols-[1fr_1.4fr_1fr] items-end border-b-2 border-black pb-1 text-lg font-bold">
          <span>Job</span>
          <span>{snap.job.job_no}</span>
          <span>{snap.job.title}</span>
        </div>

        <div className="mt-8 grid grid-cols-[1fr_1.4fr_1fr] items-baseline gap-y-3">
          <span className="font-bold">สรุปค่าแรง</span>
          <span>{snap.job.contractor || '-'}</span>
          <span className="tabular text-right">{fmtMoney(snap.subtotal)}</span>

          <span>Date:</span>
          <span>{periodText(snap.period.from, snap.period.to)}</span>
          <span />

          <span className="text-right pr-6">หัก</span>
          <span>-{fmtNum(snap.settings.wht_rate)}%</span>
          <span className="tabular text-right">({fmtMoney(snap.wht)})</span>
        </div>

        <div className="mt-10 grid grid-cols-[1fr_1.4fr_1fr]">
          <span />
          <div className="col-span-2 grid grid-cols-[1.4fr_1fr] items-center bg-slate-200 px-3 py-3 font-bold">
            <span>Total</span>
            <span className="tabular text-right">{fmtMoney(snap.net)}</span>
          </div>
        </div>

        <p className="mt-16 text-[9px] text-slate-500">
          เอกสารสร้างจากระบบ OSA Timesheet · เลขอ้างอิง {cs.id.slice(0, 8).toUpperCase()} · {snap.workers.length} คน · แนบ Time Sheet ประกอบ
        </p>
      </div>
    </Paper>
  )
}

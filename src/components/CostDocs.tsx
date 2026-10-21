import { FileDown, FileSpreadsheet } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { downloadCsv } from '../lib/csv'
import { fmtOut, fmtTime } from '../lib/format'
import { useLoad } from '../lib/hooks'
import { loadCost } from '../print/common'
import { SummaryDoc } from '../print/PrintSummary'
import { TimesheetDoc } from '../print/PrintTimesheet'
import type { CostSnapshot } from '../lib/types'
import { DocPreview } from './DocPreview'
import { Button, Card, CardHeader, ErrorBox, Spinner, Tabs } from './ui'

export type DocTab = 'timesheet' | 'summary'

/** เอกสารของใบคิดราคา แสดงในหน้า พร้อมปุ่ม Export PDF / Excel */
export function CostDocs({ id, tab, onTab }: { id: string; tab: DocTab; onTab: (t: DocTab) => void }) {
  const { data, error } = useLoad(() => loadCost(id), [id])
  const [csvBusy, setCsvBusy] = useState(false)

  function exportCsv(kind: 'summary' | 'daily', snap: CostSnapshot) {
    setCsvBusy(true)
    const base = `${snap.job.job_no}_${snap.period.from}_${snap.period.to}`
    if (kind === 'summary') {
      const rows: (string | number)[][] = [
        [`Job ${snap.job.job_no} ${snap.job.title}`, `ผู้รับเหมา ${snap.job.contractor ?? '-'}`, `ช่วงวันที่ ${snap.period.from} ถึง ${snap.period.to}`],
        [],
        ['ลำดับ', 'ชื่อ', 'ตำแหน่ง', 'ทีม', 'ค่าแรง/วัน', 'เรท/ชม.', 'วันทำงาน', 'ชม.ปกติ', 'ชม.OT x1.5', 'ชม.วันหยุด x2', 'ชม.OT วันหยุด x3',
          'เงินปกติ', 'เงิน OT x1.5', 'เงินวันหยุด x2', 'เงิน OT วันหยุด x3', 'Allowance', 'รวม'],
        ...snap.workers.map((w, i) => [i + 1, w.name, w.position, w.team, w.day_rate, w.unit, w.work_days,
          w.hours.n1, w.hours.ot15, w.hours.h2, w.hours.h3, w.amounts.n1, w.amounts.ot15, w.amounts.h2, w.amounts.h3, w.allowance_total, w.total]),
        [],
        ['', 'ยอดรวม', '', '', '', '', '', '', '', '', '', '', '', '', '', '', snap.subtotal],
        ['', `หัก ณ ที่จ่าย ${snap.settings.wht_rate}%`, '', '', '', '', '', '', '', '', '', '', '', '', '', '', -snap.wht],
        ['', 'ยอดจ่ายสุทธิ', '', '', '', '', '', '', '', '', '', '', '', '', '', '', snap.net],
      ]
      downloadCsv(`สรุปค่าแรง_${base}.csv`, rows)
    } else {
      const rows: (string | number)[][] = [['วันที่', 'ชื่อ', 'ตำแหน่ง', 'ทีม', 'ประเภทวัน', 'เวลาเข้า', 'เวลาออก', 'ชม.ปกติ', 'ชม.OT', 'Allowance']]
      for (const w of snap.workers)
        for (const d of w.days)
          rows.push([d.date, w.name, w.position, w.team, d.holiday ? 'วันหยุด' : 'ปกติ', fmtTime(d.in), fmtOut(d.in, d.out), d.normal, d.ot,
            w.allowances.filter((a) => a.date === d.date).reduce((s, a) => s + Number(a.amount), 0) || ''])
      rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1]), 'th'))
      downloadCsv(`TimeSheet_รายวัน_${base}.csv`, rows)
    }
    setCsvBusy(false)
  }

  return (
    <Card>
      <CardHeader
        title="เอกสาร"
        sub={data && data.cs.status !== 'approved' ? 'ยังไม่อนุมัติ เอกสารจะมีลายน้ำ "ร่าง"' : 'พร้อมแนบใบขอซื้อ'}
        right={
          data && (
            <>
              <Link to={`/print/${tab}/${id}?auto=1`} target="_blank">
                <Button size="sm">
                  <FileDown className="size-4" /> Export PDF
                </Button>
              </Link>
              <Button size="sm" variant="secondary" loading={csvBusy} onClick={() => exportCsv('summary', data.snap)}>
                <FileSpreadsheet className="size-4" /> Excel สรุปรายคน
              </Button>
              <Button size="sm" variant="secondary" loading={csvBusy} onClick={() => exportCsv('daily', data.snap)}>
                <FileSpreadsheet className="size-4" /> Excel รายวัน
              </Button>
            </>
          )
        }
      />
      <div className="p-5">
        <Tabs
          value={tab}
          onChange={onTab}
          items={[
            { value: 'timesheet', label: 'Time Sheet' },
            { value: 'summary', label: 'สรุปค่าแรง' },
          ]}
        />
        {error ? (
          <ErrorBox message={error} />
        ) : !data ? (
          <Spinner />
        ) : tab === 'timesheet' ? (
          <DocPreview landscape>
            <TimesheetDoc data={data} />
          </DocPreview>
        ) : (
          <DocPreview>
            <SummaryDoc data={data} />
          </DocPreview>
        )}
      </div>
    </Card>
  )
}

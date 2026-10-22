import { PiggyBank } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { fmtDate, fmtMoney } from '../lib/format'
import { must, useLoad } from '../lib/hooks'
import { supabase } from '../lib/supabase'
import { Button, Card, CardHeader, cx, ErrorBox, Field, Input, Modal, Spinner, useToast } from './ui'

export type JobBudget = {
  job_id: string
  job_no: string
  title: string
  status: string
  budget: number | null
  spent: number
  days: { date: string; amount: number }[]
}

/** สีตามสัดส่วนที่ใช้ไป: เขียว < 80% · เหลือง 80–100% · แดง เกิน */
function tone(b: JobBudget) {
  if (!b.budget) return { bar: 'bg-slate-300', text: 'text-slate-500', pct: 0 }
  const pct = (Number(b.spent) / Number(b.budget)) * 100
  if (pct > 100) return { bar: 'bg-rose-500', text: 'text-rose-600', pct }
  if (pct >= 80) return { bar: 'bg-amber-500', text: 'text-amber-700', pct }
  return { bar: 'bg-emerald-500', text: 'text-emerald-700', pct }
}

export function BudgetBar({ b }: { b: JobBudget }) {
  const t = tone(b)
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={cx('h-full rounded-full', t.bar)} style={{ width: `${Math.min(100, t.pct)}%` }} />
    </div>
  )
}

/** ตั้ง Budget (ทุกคนที่เห็นจ็อบตั้งได้ · บันทึกในประวัติการแก้ไข) */
export function BudgetModal({ b, onClose, onSaved }: { b: JobBudget | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [v, setV] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    if (!b) return
    const n = v.trim() === '' ? null : Number(v.replace(/,/g, ''))
    if (n !== null && !(n >= 0)) return toast.err('จำนวนเงินไม่ถูกต้อง')
    setBusy(true)
    const { error } = await supabase.rpc('set_job_budget', { p_job: b.job_id, p_budget: n })
    setBusy(false)
    if (error) return toast.err(error)
    toast.ok('บันทึก Budget แล้ว')
    onSaved()
    onClose()
  }
  return (
    <Modal
      open={Boolean(b)}
      onClose={onClose}
      title={`ตั้ง Budget ${b?.job_no ?? ''}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button onClick={save} loading={busy}>
            บันทึก
          </Button>
        </>
      }
    >
      <Field label="Budget ค่าแรงทั้งจ็อบ (บาท)" hint="เทียบกับยอดรวมก่อนหัก 3% · เว้นว่าง = ยกเลิก Budget">
        <Input
          autoFocus
          type="number"
          min={0}
          step="1"
          defaultValue={b?.budget ?? ''}
          key={b?.job_id}
          onChange={(e) => setV(e.target.value)}
          placeholder="เช่น 250000"
        />
      </Field>
    </Modal>
  )
}

/** การ์ด Budget ในหน้าจ็อบ: ตั้งงบ ดูที่ใช้ไป และหักรายวัน */
export function JobBudgetCard({ jobId }: { jobId: string }) {
  const [edit, setEdit] = useState<JobBudget | null>(null)
  const [showDays, setShowDays] = useState(false)
  const { data, error, reload } = useLoad(async () => (must(await supabase.rpc('job_budgets', { p_job: jobId })) as JobBudget[])[0] ?? null, [jobId])
  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (!data) return <Spinner />
  const b = data
  const t = tone(b)
  const remain = b.budget != null ? Number(b.budget) - Number(b.spent) : null
  let left = Number(b.budget ?? 0)
  const rows = b.days.map((d) => {
    left -= Number(d.amount)
    return { ...d, left }
  })

  return (
    <Card className="mb-6">
      <CardHeader
        title="Budget ค่าแรง"
        sub="หักทุกวันที่ใบลงเวลาอนุมัติครบ 2 ชั้น (ยอดรวมก่อนหัก 3%)"
        right={
          <Button size="sm" variant="secondary" onClick={() => setEdit(b)}>
            <PiggyBank className="size-4" /> {b.budget != null ? 'แก้ Budget' : 'ตั้ง Budget'}
          </Button>
        }
      />
      <div className="space-y-3 p-5">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-slate-500">Budget</p>
            <p className="tabular text-lg font-semibold text-slate-900">{b.budget != null ? fmtMoney(b.budget) : '—'}</p>
          </div>
          <div>
            <p className="text-slate-500">ใช้ไปแล้ว</p>
            <p className="tabular text-lg font-semibold text-slate-900">{fmtMoney(b.spent)}</p>
          </div>
          <div>
            <p className="text-slate-500">คงเหลือ</p>
            <p className={cx('tabular text-lg font-semibold', remain != null && remain < 0 ? 'text-rose-600' : 'text-slate-900')}>
              {remain != null ? fmtMoney(remain) : '—'}
            </p>
          </div>
        </div>
        {b.budget != null && (
          <>
            <BudgetBar b={b} />
            <p className={cx('text-sm font-medium', t.text)}>
              ใช้ไป {t.pct.toFixed(1)}%{t.pct > 100 ? ' — เกิน Budget แล้ว' : t.pct >= 80 ? ' — ใกล้เต็ม Budget' : ''}
            </p>
          </>
        )}
        {rows.length > 0 && (
          <button onClick={() => setShowDays(!showDays)} className="text-sm text-brand-600 hover:underline">
            {showDays ? 'ซ่อนรายวัน' : `ดูการหักรายวัน (${rows.length} วัน)`}
          </button>
        )}
        {showDays && (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="py-1.5">วันที่</th>
                <th className="py-1.5 text-right">หัก</th>
                {b.budget != null && <th className="py-1.5 text-right">คงเหลือ</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...rows].reverse().map((d) => (
                <tr key={d.date}>
                  <td className="py-1.5">{fmtDate(d.date)}</td>
                  <td className="tabular py-1.5 text-right">-{fmtMoney(d.amount)}</td>
                  {b.budget != null && <td className={cx('tabular py-1.5 text-right', d.left < 0 && 'text-rose-600')}>{fmtMoney(d.left)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <BudgetModal b={edit} onClose={() => setEdit(null)} onSaved={reload} />
    </Card>
  )
}

/** ภาพรวม Budget ทุกจ็อบที่เปิดอยู่ (หน้า Dashboard) */
export function BudgetOverview() {
  const [edit, setEdit] = useState<JobBudget | null>(null)
  const { data, error, reload } = useLoad(async () => must(await supabase.rpc('job_budgets')) as JobBudget[], [])
  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (!data) return <Spinner />
  return (
    <Card className="mb-6">
      <CardHeader title="Budget ค่าแรงต่อจ็อบ" sub="หักทุกวันที่ใบลงเวลาอนุมัติครบ · ยอดรวมก่อนหัก 3%" />
      {data.length === 0 ? (
        <p className="p-5 text-sm text-slate-500">ยังไม่มีจ็อบที่เปิดอยู่</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.map((b) => {
            const t = tone(b)
            const remain = b.budget != null ? Number(b.budget) - Number(b.spent) : null
            return (
              <li key={b.job_id} className="space-y-2 px-5 py-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link to={`/jobs/${b.job_id}`} className="font-medium text-slate-900 hover:underline">
                    <span className="font-mono text-brand-700">{b.job_no}</span> · {b.title}
                  </Link>
                  {b.budget != null ? (
                    <span className={cx('tabular text-sm font-medium', t.text)}>
                      ใช้ {fmtMoney(b.spent)} / {fmtMoney(b.budget)} · เหลือ {fmtMoney(remain)}
                    </span>
                  ) : (
                    <button onClick={() => setEdit(b)} className="text-sm text-brand-600 hover:underline">
                      ใช้ไป {fmtMoney(b.spent)} · ตั้ง Budget
                    </button>
                  )}
                </div>
                {b.budget != null && <BudgetBar b={b} />}
              </li>
            )
          })}
        </ul>
      )}
      <BudgetModal b={edit} onClose={() => setEdit(null)} onSaved={reload} />
    </Card>
  )
}

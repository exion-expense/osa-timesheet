import { AlertTriangle, ArrowLeft, Check, FileText, Printer, RotateCcw, Send, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { TermsStatus } from '../components/TermsStatus'
import { Badge, Button, Card, CardHeader, ErrorBox, Field, Input, Modal, PageHeader, Spinner, Stat, Textarea, useToast } from '../components/ui'
import { useAuth } from '../lib/auth'
import { fmtDate, fmtDateTime, fmtHours, fmtMoney, fmtNum } from '../lib/format'
import { must, useLoad } from '../lib/hooks'
import { CostBadge } from '../lib/status'
import { supabase } from '../lib/supabase'
import type { CostSheet as CS, CostSnapshot, Job } from '../lib/types'

export default function CostSheet() {
  const { id = '' } = useParams()
  const { is, profile } = useAuth()
  const toast = useToast()
  const nav = useNavigate()
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState<{ kind: 'reject' | 'reopen'; text: string } | null>(null)
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null)

  const { data, error, loading, reload } = useLoad(async () => {
    const cs = must(await supabase.from('cost_sheets').select('*').eq('id', id).single()) as CS
    const [job, teams, appr] = await Promise.all([
      supabase.from('jobs').select('*').eq('id', cs.job_id).single(),
      supabase.from('teams').select('supervisor_id, supervisor:profiles(id, full_name, email)').eq('job_id', cs.job_id),
      supabase.from('cost_sheet_approvals').select('supervisor_id, approved_at').eq('cost_sheet_id', id),
    ])
    const snap =
      cs.status === 'draft'
        ? (must(await supabase.rpc('cost_preview', { p_job: cs.job_id, p_from: cs.period_from, p_to: cs.period_to })) as CostSnapshot)
        : (cs.snapshot as CostSnapshot)
    const sups = new Map<string, string>()
    ;(must(teams) as unknown as { supervisor: { id: string; full_name: string; email: string } | null }[]).forEach(
      (t) => t.supervisor && sups.set(t.supervisor.id, t.supervisor.full_name || t.supervisor.email),
    )
    return { cs, job: must(job) as Job, snap, sups, appr: must(appr) as { supervisor_id: string; approved_at: string }[] }
  }, [id])

  if (loading && !data) return <Spinner />
  if (error || !data) return <ErrorBox message={error ?? 'ไม่พบใบคิดราคา'} onRetry={reload} />
  const { cs, job, snap, sups, appr } = data
  const draft = cs.status === 'draft'
  const canEdit = draft && is('purchase', 'admin')
  const isJobSup = is('supervisor') && sups.has(profile?.id ?? '')
  const iApproved = appr.some((a) => a.supervisor_id === profile?.id)
  const totalHours = snap.workers.reduce((s, w) => s + w.hours.n1 + w.hours.ot15 + w.hours.h2 + w.hours.h3, 0)
  const manDays = snap.workers.reduce((s, w) => s + w.work_days, 0)

  async function call(fn: string, args: Record<string, unknown>, ok: string) {
    setBusy(true)
    const { error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) return toast.err(error)
    toast.ok(ok)
    reload()
  }

  async function saveRate(workerId: string, v: string) {
    const n = Number(v)
    if (!(n >= 0)) return toast.err('ค่าแรงไม่ถูกต้อง')
    const { error } = await supabase.from('worker_rates').upsert({ worker_id: workerId, day_rate: n })
    if (error) return toast.err(error)
    reload()
  }

  async function applyRateAll(v: string) {
    const n = Number(v)
    if (!(n > 0)) return
    if (!confirm(`ใส่ค่าแรง ${fmtMoney(n)} บาท/วัน ให้ทุกคนที่ยังไม่มีค่าแรง?`)) return
    const rows = snap.workers.filter((w) => !w.day_rate).map((w) => ({ worker_id: w.worker_id, day_rate: n }))
    if (!rows.length) return
    const { error } = await supabase.from('worker_rates').upsert(rows)
    if (error) return toast.err(error)
    toast.ok(`ใส่ค่าแรงให้ ${rows.length} คน`)
    reload()
  }

  async function saveTerms(patch: Partial<Job>) {
    const { error } = await supabase.from('jobs').update(patch).eq('id', job.id)
    if (error) return toast.err(error)
    reload()
  }

  async function savePeriod() {
    if (!period) return
    const { error } = await supabase.from('cost_sheets').update({ period_from: period.from, period_to: period.to }).eq('id', id)
    if (error) return toast.err(error)
    setPeriod(null)
    reload()
  }

  async function remove() {
    if (!confirm('ลบใบคิดราคาร่างนี้?')) return
    const { error } = await supabase.from('cost_sheets').delete().eq('id', id)
    if (error) return toast.err(error)
    nav(`/jobs/${job.id}`, { replace: true })
  }

  const blockers = [
    !job.terms_confirmed_at && 'ยังไม่ได้ยืนยันเงื่อนไขคิดราคา (5/6 วัน และพักเย็น)',
    snap.pending_days > 0 && `ยังมีใบลงเวลารายวัน ${snap.pending_days} ใบที่อนุมัติไม่ครบ`,
    snap.missing_rates > 0 && `ยังไม่ได้ใส่ค่าแรง ${snap.missing_rates} คน`,
    snap.workers.length === 0 && 'ไม่มีข้อมูลในช่วงวันที่นี้',
  ].filter(Boolean) as string[]

  return (
    <>
      <PageHeader
        back={
          <Link to={`/jobs/${job.id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft className="size-4" /> {job.job_no} · {job.title}
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            ใบคิดราคา
            <CostBadge c={cs} />
            {cs.revision > 0 && <Badge tone="blue">Revise {cs.revision}</Badge>}
          </span>
        }
        sub={
          <span>
            {fmtDate(cs.period_from)} – {fmtDate(cs.period_to)}
            {canEdit && (
              <button className="ml-2 text-brand-600 hover:underline" onClick={() => setPeriod({ from: cs.period_from, to: cs.period_to })}>
                เปลี่ยนช่วงวันที่
              </button>
            )}
          </span>
        }
        right={
          <>
            <Link to={`/print/timesheet/${cs.id}`} target="_blank">
              <Button variant="secondary">
                <Printer className="size-4" /> Time Sheet
              </Button>
            </Link>
            <Link to={`/print/summary/${cs.id}`} target="_blank">
              <Button variant="secondary">
                <FileText className="size-4" /> สรุปค่าแรง
              </Button>
            </Link>
          </>
        }
      />

      {cs.reject_reason && draft && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <b>ถูกตีกลับ ({fmtDateTime(cs.rejected_at)}):</b> {cs.reject_reason}
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="ยอดรวม" value={`${fmtMoney(snap.subtotal)}`} sub="บาท" />
        <Stat label={`หัก ณ ที่จ่าย ${fmtNum(snap.settings.wht_rate)}%`} value={`(${fmtMoney(snap.wht)})`} sub="บาท" tone="amber" />
        <Stat label="ยอดสุทธิ" value={fmtMoney(snap.net)} sub="บาท" tone="green" />
        <Stat label="แรงงาน" value={`${manDays} แรง`} sub={`${snap.workers.length} คน · ${fmtNum(totalHours)} ชม.`} tone="gray" />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="เงื่อนไขการคิด" sub={canEdit ? 'Purchase เปลี่ยนได้ก่อนส่งอนุมัติ' : undefined} />
          {draft && (
            <div className="px-5 pt-5">
              <TermsStatus job={job} canEdit={canEdit} onConfirm={() => saveTerms({ terms_confirmed_at: new Date().toISOString() })} />
            </div>
          )}
          <div className="grid gap-3 p-5 sm:grid-cols-2">
            <Choice
              label="วันทำงาน"
              disabled={!canEdit}
              value={String(snap.job.workweek)}
              options={[
                { v: '6', t: '6 วัน (อาทิตย์ ×2)' },
                { v: '5', t: '5 วัน (เสาร์-อาทิตย์ ×2)' },
              ]}
              onChange={(v) => saveTerms({ workweek: Number(v) as 5 | 6 })}
            />
            <Choice
              label="พักเย็นก่อน OT"
              disabled={!canEdit}
              value={String(snap.job.evening_break)}
              options={[
                { v: 'true', t: `พัก ${snap.settings.break_minutes} นาที` },
                { v: 'false', t: 'ไม่พัก (OT ต่อเลย)' },
              ]}
              onChange={(v) => saveTerms({ evening_break: v === 'true' })}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="การอนุมัติ" sub="หัวหน้างานของจ็อบต้องอนุมัติครบทุกคน" />
          <ul className="space-y-3 p-5">
            {[...sups.entries()].map(([sid, name]) => {
              const a = appr.find((x) => x.supervisor_id === sid)
              return (
                <li key={sid} className="flex items-center gap-3">
                  <div className={`flex size-7 items-center justify-center rounded-full ${a ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                    <Check className="size-4" />
                  </div>
                  <div className="text-sm">
                    <p className="font-medium text-slate-900">{name}</p>
                    <p className="text-xs text-slate-500">{a ? fmtDateTime(a.approved_at) : cs.status === 'submitted' ? 'รออนุมัติ' : '—'}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      </div>

      {/* แถบปุ่มดำเนินการ */}
      <Card className="mb-6 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-600">
            {draft && blockers.length > 0 && (
              <ul className="space-y-1">
                {blockers.map((b) => (
                  <li key={b} className="flex items-center gap-2 text-amber-700">
                    <AlertTriangle className="size-4" /> {b}
                  </li>
                ))}
              </ul>
            )}
            {draft && blockers.length === 0 && <span className="text-emerald-700">พร้อมส่งให้หัวหน้างานอนุมัติ</span>}
            {cs.status === 'submitted' && <span>ส่งเมื่อ {fmtDateTime(cs.submitted_at)} · ตัวเลขถูกล็อกแล้ว</span>}
            {cs.status === 'approved' && <span className="text-emerald-700">อนุมัติครบเมื่อ {fmtDateTime(cs.approved_at)} · พิมพ์เอกสารแนบใบขอซื้อได้</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <>
                <Button variant="ghost" onClick={remove}>
                  <Trash2 className="size-4" /> ลบร่าง
                </Button>
                <Button loading={busy} disabled={blockers.length > 0} onClick={() => call('submit_cost_sheet', { p_id: id }, 'ส่งให้หัวหน้างานอนุมัติแล้ว')}>
                  <Send className="size-4" /> ส่งให้หัวหน้างานอนุมัติ
                </Button>
              </>
            )}
            {cs.status === 'submitted' && isJobSup && !iApproved && (
              <>
                <Button variant="secondary" onClick={() => setReason({ kind: 'reject', text: '' })}>
                  <X className="size-4" /> ตีกลับ
                </Button>
                <Button variant="success" loading={busy} onClick={() => call('approve_cost_sheet', { p_id: id }, 'อนุมัติแล้ว')}>
                  <Check className="size-4" /> อนุมัติราคา
                </Button>
              </>
            )}
            {cs.status !== 'draft' && is('admin') && (
              <Button variant="secondary" onClick={() => setReason({ kind: 'reopen', text: '' })}>
                <RotateCcw className="size-4" /> เปิดแก้ไข (Revise)
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="รายละเอียดรายคน"
          sub={`เรทต่อชั่วโมง = ค่าแรงต่อวัน ÷ ${fmtNum(snap.settings.normal_hours)}`}
          right={
            canEdit &&
            snap.missing_rates > 0 && (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  applyRateAll((e.currentTarget.elements.namedItem('all') as HTMLInputElement).value)
                }}
              >
                <Input name="all" type="number" min={0} step="1" placeholder="ค่าแรง/วัน" className="w-32" />
                <Button size="sm" variant="secondary" type="submit">
                  ใส่ให้ทุกคนที่ว่าง
                </Button>
              </form>
            )
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50 text-xs font-medium text-slate-500">
              <tr>
                <th className="px-5 py-2.5 text-left">ชื่อ</th>
                <th className="px-3 py-2.5 text-right">ค่าแรง/วัน</th>
                <th className="px-3 py-2.5 text-center">ปกติ ×1</th>
                <th className="px-3 py-2.5 text-center">OT ×1.5</th>
                <th className="px-3 py-2.5 text-center">หยุด ×2</th>
                <th className="px-3 py-2.5 text-center">OT หยุด ×3</th>
                <th className="px-3 py-2.5 text-right">Allowance</th>
                <th className="px-5 py-2.5 text-right">รวม (บาท)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {snap.workers.map((w) => (
                <tr key={w.worker_id} className="align-top">
                  <td className="px-5 py-3">
                    <p className="font-medium text-slate-900">{w.name}</p>
                    <p className="text-xs text-slate-500">
                      {w.position} · {w.team} · {w.work_days} วัน
                      {w.days.some((d) => !d.approved) && draft && <span className="ml-1 text-amber-600">· มีวันที่ยังไม่อนุมัติ</span>}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-right">
                    {canEdit ? (
                      <input
                        type="number"
                        min={0}
                        step="1"
                        defaultValue={w.day_rate || ''}
                        key={`${w.worker_id}-${w.day_rate}`}
                        aria-label={`ค่าแรงต่อวัน ${w.name}`}
                        onBlur={(e) => e.target.value !== String(w.day_rate || '') && saveRate(w.worker_id, e.target.value)}
                        className={`tabular w-24 rounded-lg border px-2 py-1 text-right ${w.day_rate ? 'border-slate-300' : 'border-amber-400 bg-amber-50'}`}
                        placeholder="0"
                      />
                    ) : (
                      <span className="tabular">{fmtMoney(w.day_rate)}</span>
                    )}
                    <p className="tabular mt-0.5 text-xs text-slate-400">{fmtMoney(w.unit)}/ชม.</p>
                  </td>
                  {(['n1', 'ot15', 'h2', 'h3'] as const).map((k) => (
                    <td key={k} className="tabular px-3 py-3 text-center">
                      <p className="font-medium">{fmtHours(w.hours[k]) || <span className="text-slate-300">–</span>}</p>
                      {w.amounts[k] > 0 && <p className="text-xs text-slate-500">{fmtMoney(w.amounts[k])}</p>}
                    </td>
                  ))}
                  <td className="tabular px-3 py-3 text-right">{w.allowance_total > 0 ? fmtMoney(w.allowance_total) : <span className="text-slate-300">–</span>}</td>
                  <td className="tabular px-5 py-3 text-right font-semibold text-slate-900">{fmtMoney(w.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
              <tr>
                <td className="px-5 py-3" colSpan={2}>
                  รวมทั้งหมด
                </td>
                {(['n1', 'ot15', 'h2', 'h3'] as const).map((k) => (
                  <td key={k} className="tabular px-3 py-3 text-center">
                    {fmtHours(snap.workers.reduce((s, w) => s + w.hours[k], 0)) || '0'}
                  </td>
                ))}
                <td className="tabular px-3 py-3 text-right">{fmtMoney(snap.workers.reduce((s, w) => s + w.allowance_total, 0))}</td>
                <td className="tabular px-5 py-3 text-right">{fmtMoney(snap.subtotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Modal
        open={Boolean(reason)}
        onClose={() => setReason(null)}
        title={reason?.kind === 'reject' ? 'ตีกลับใบคิดราคา' : 'เปิดใบคิดราคาให้แก้ไขใหม่'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReason(null)}>
              ยกเลิก
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={async () => {
                if (!reason) return
                await call(reason.kind === 'reject' ? 'reject_cost_sheet' : 'reopen_cost_sheet', { p_id: id, p_reason: reason.text }, 'ส่งกลับเป็นร่างแล้ว')
                setReason(null)
              }}
            >
              ยืนยัน
            </Button>
          </>
        }
      >
        <Field label="เหตุผล" hint="Purchase จะเห็นข้อความนี้">
          <Textarea rows={3} autoFocus value={reason?.text ?? ''} onChange={(e) => reason && setReason({ ...reason, text: e.target.value })} />
        </Field>
      </Modal>

      <Modal
        open={Boolean(period)}
        onClose={() => setPeriod(null)}
        title="ช่วงวันที่"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPeriod(null)}>
              ยกเลิก
            </Button>
            <Button onClick={savePeriod}>บันทึก</Button>
          </>
        }
      >
        {period && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="ตั้งแต่">
              <Input type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} />
            </Field>
            <Field label="ถึง">
              <Input type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>
    </>
  )
}

function Choice({ label, value, options, onChange, disabled }: { label: string; value: string; options: { v: string; t: string }[]; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-slate-700">{label}</p>
      <div className="flex rounded-xl bg-slate-100 p-1">
        {options.map((o) => (
          <button
            key={o.v}
            disabled={disabled}
            onClick={() => o.v !== value && onChange(o.v)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${o.v === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'} ${disabled ? 'cursor-default' : 'hover:text-slate-900'}`}
          >
            {o.t}
          </button>
        ))}
      </div>
    </div>
  )
}

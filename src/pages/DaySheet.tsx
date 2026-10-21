import { ArrowLeft, Check, CircleDollarSign, FileDown, Pencil, Plus, Trash2, Undo2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { DocPreview } from '../components/DocPreview'
import { Badge, Button, Card, CardHeader, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, useToast } from '../components/ui'
import { DayDoc, loadDay } from '../print/PrintDay'
import { useAuth } from '../lib/auth'
import { addDays, bkkIso, fmtDate, fmtDateLong, fmtDateTime, fmtHours, fmtMoney, fmtOut, fmtTime } from '../lib/format'
import { must, useLoad } from '../lib/hooks'
import { DayBadge } from '../lib/status'
import { supabase } from '../lib/supabase'
import type { Allowance, AttendanceHours, DaySheet as Sheet, Worker } from '../lib/types'

const KINDS = ['ค่ารถ/ค่าเดินทาง', 'ค่าอาหาร', 'ค่าที่พัก', 'อื่นๆ']

export default function DaySheet() {
  const { id = '' } = useParams()
  const { is, profile } = useAuth()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [editAtt, setEditAtt] = useState<{ id?: string; worker_id: string; in: string; out: string; note: string } | null>(null)
  const [reject, setReject] = useState<string | null>(null)
  const [allow, setAllow] = useState<{ kind: string; mode: 'each' | 'split'; amount: string; picked: string[] } | null>(null)

  const { data, error, loading, reload } = useLoad(async () => {
    const sheet = must(await supabase.from('v_day_sheets').select('*').eq('id', id).single()) as Sheet
    const [rows, workers, allowances, people] = await Promise.all([
      supabase.from('v_attendance_hours').select('*').eq('team_id', sheet.team_id).eq('work_date', sheet.work_date),
      supabase.from('workers').select('*').eq('job_id', sheet.job_id).order('full_name'),
      supabase.from('allowances').select('*').eq('job_id', sheet.job_id).eq('work_date', sheet.work_date),
      supabase.from('profiles').select('id, full_name, email'),
    ])
    return {
      sheet,
      rows: must(rows) as AttendanceHours[],
      workers: must(workers) as Worker[],
      allowances: must(allowances) as Allowance[],
      people: must(people) as { id: string; full_name: string; email: string }[],
    }
  }, [id])

  const names = useMemo(() => {
    const m = new Map<string, string>()
    data?.workers.forEach((w) => m.set(w.id, w.full_name))
    return m
  }, [data])

  if (loading && !data) return <Spinner />
  if (error || !data) return <ErrorBox message={error ?? 'ไม่พบใบลงเวลา'} onRetry={reload} />
  const { sheet, rows, workers, allowances, people } = data

  const personName = (uid: string | null) => people.find((p) => p.id === uid)?.full_name || people.find((p) => p.id === uid)?.email || '-'

  const isSup = is('supervisor') && sheet.supervisor_id === profile?.id
  const isPlanner = is('planner')
  const anyApproval = Boolean(sheet.supervisor_approved_at || sheet.planner_approved_at)
  const canEditTimes = (isSup || is('admin')) && !anyApproval
  const canAllow = (isPlanner || is('admin')) && !sheet.planner_approved_at
  const sorted = [...rows].sort((a, b) => (names.get(a.worker_id) ?? '').localeCompare(names.get(b.worker_id) ?? '', 'th'))
  const holiday = rows[0]?.holiday
  const allowFor = (w: string) => allowances.filter((a) => a.worker_id === w)
  const notCame = workers.filter((w) => w.team_id === sheet.team_id && w.active && !rows.some((r) => r.worker_id === w.id))

  async function rpc(fn: string, args: Record<string, unknown>, ok: string) {
    setBusy(true)
    const { error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) return toast.err(error)
    toast.ok(ok)
    reload()
  }

  async function saveAtt() {
    if (!editAtt) return
    if (!editAtt.in) return toast.err('กรุณาใส่เวลาเข้า')
    if (editAtt.note.trim().length < 3) return toast.err('กรุณาระบุเหตุผลการแก้ไข')
    const payload = {
      check_in: bkkIso(sheet.work_date, editAtt.in),
      // เวลาออกน้อยกว่าหรือเท่ากับเวลาเข้า = ออกวันถัดไป (ทำงานข้ามเที่ยงคืน)
      check_out: editAtt.out ? bkkIso(editAtt.out <= editAtt.in ? addDays(sheet.work_date, 1) : sheet.work_date, editAtt.out) : null,
      note: editAtt.note.trim(),
    }
    setBusy(true)
    const res = editAtt.id
      ? await supabase.from('attendance').update(payload).eq('id', editAtt.id)
      : await supabase.from('attendance').insert({ ...payload, worker_id: editAtt.worker_id, job_id: sheet.job_id, team_id: sheet.team_id, work_date: sheet.work_date })
    setBusy(false)
    if (res.error) return toast.err(res.error)
    toast.ok('บันทึกเวลาแล้ว')
    setEditAtt(null)
    reload()
  }

  async function delAtt(r: AttendanceHours) {
    if (!confirm(`ลบเวลาของ ${names.get(r.worker_id)} วันนี้?`)) return
    const { error } = await supabase.from('attendance').delete().eq('id', r.id)
    if (error) return toast.err(error)
    toast.ok('ลบแล้ว')
    reload()
  }

  async function saveAllow() {
    if (!allow) return
    const total = Number(allow.amount)
    if (!(total >= 0) || !allow.picked.length) return toast.err('เลือกคนและใส่จำนวนเงิน')
    const each = allow.mode === 'split' ? Math.floor((total / allow.picked.length) * 100) / 100 : total
    const remainder = allow.mode === 'split' ? Math.round((total - each * allow.picked.length) * 100) / 100 : 0
    const rowsUp = allow.picked.map((w, i) => ({
      worker_id: w,
      job_id: sheet.job_id,
      work_date: sheet.work_date,
      kind: allow.kind,
      amount: i === 0 ? each + remainder : each,
    }))
    setBusy(true)
    const { error } = await supabase.from('allowances').upsert(rowsUp, { onConflict: 'worker_id,work_date,kind' })
    setBusy(false)
    if (error) return toast.err(error)
    toast.ok('บันทึก Allowance แล้ว')
    setAllow(null)
    reload()
  }

  async function updateAllowance(a: Allowance, v: string) {
    const n = Number(v)
    if (!(n >= 0)) return
    const res = n === 0 ? await supabase.from('allowances').delete().eq('id', a.id) : await supabase.from('allowances').update({ amount: n }).eq('id', a.id)
    if (res.error) return toast.err(res.error)
    reload()
  }

  const totals = rows.reduce(
    (s, r) => ({ n: s.n + Number(r.normal_h), ot: s.ot + Number(r.ot_h) }),
    { n: 0, ot: 0 },
  )
  const allowTotal = allowances.filter((a) => rows.some((r) => r.worker_id === a.worker_id)).reduce((s, a) => s + Number(a.amount), 0)

  const allowView = (r: AttendanceHours) => (
    <div className="flex flex-wrap gap-1">
      {allowFor(r.worker_id).map((a) =>
        canAllow ? (
          <label key={a.id} className="inline-flex items-center gap-1 rounded-lg bg-violet-50 px-2 py-0.5 text-xs text-violet-700">
            {a.kind}
            <input
              type="number"
              min={0}
              step="0.01"
              defaultValue={a.amount}
              aria-label={`${a.kind} ${names.get(a.worker_id) ?? ''}`}
              onBlur={(e) => e.target.value !== String(a.amount) && updateAllowance(a, e.target.value)}
              className="w-16 rounded border border-violet-200 bg-white px-1 text-right"
            />
          </label>
        ) : (
          <Badge key={a.id} tone="violet">
            {a.kind} {fmtMoney(a.amount)}
          </Badge>
        ),
      )}
    </div>
  )
  const rowActions = (r: AttendanceHours) =>
    canEditTimes && (
      <div className="flex justify-end gap-1">
        <button
          onClick={() => setEditAtt({ id: r.id, worker_id: r.worker_id, in: fmtTime(r.check_in), out: r.check_out ? fmtTime(r.check_out) : '', note: '' })}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
          title="แก้เวลา"
        >
          <Pencil className="size-4" />
        </button>
        <button onClick={() => delAtt(r)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="ลบ">
          <Trash2 className="size-4" />
        </button>
      </div>
    )

  return (
    <>
      <PageHeader
        back={
          <Link to={`/jobs/${sheet.job_id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft className="size-4" /> {sheet.job_no} · {sheet.job_title}
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {fmtDateLong(sheet.work_date)}
            {holiday && <Badge tone="violet">วันหยุด ×2 / ×3</Badge>}
          </span>
        }
        sub={`${sheet.team_name} · ${rows.length} คน`}
        right={
          <>
            <Link to={`/print/day/${sheet.id}?auto=1`} target="_blank">
              <Button variant="secondary">
                <FileDown className="size-4" /> Export PDF
              </Button>
            </Link>
          </>
        }
      />

      {/* แถบสถานะการอนุมัติ */}
      <Card className="mb-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-6">
            <Step label="หัวหน้างาน" at={sheet.supervisor_approved_at} by={personName(sheet.supervisor_approved_by)} />
            <Step label="Planner" at={sheet.planner_approved_at} by={personName(sheet.planner_approved_by)} />
            <DayBadge d={sheet} />
          </div>
          <div className="flex flex-wrap gap-2">
            {isSup && !sheet.supervisor_approved_at && (
              <Button variant="success" loading={busy} onClick={() => rpc('approve_day', { p_sheet: id }, 'อนุมัติแล้ว')}>
                <Check className="size-4" /> อนุมัติใบนี้
              </Button>
            )}
            {isSup && sheet.supervisor_approved_at && !sheet.planner_approved_at && (
              <Button variant="secondary" loading={busy} onClick={() => rpc('unapprove_day', { p_sheet: id }, 'ยกเลิกอนุมัติแล้ว')}>
                <Undo2 className="size-4" /> ยกเลิกอนุมัติเพื่อแก้ไข
              </Button>
            )}
            {isPlanner && sheet.supervisor_approved_at && !sheet.planner_approved_at && (
              <>
                <Button variant="secondary" onClick={() => setReject('')}>
                  <X className="size-4" /> ตีกลับ
                </Button>
                <Button variant="success" loading={busy} onClick={() => rpc('approve_day', { p_sheet: id }, 'อนุมัติแล้ว ส่งต่อไปคิดราคา')}>
                  <Check className="size-4" /> อนุมัติ
                </Button>
              </>
            )}
            {(isPlanner || is('admin')) && sheet.planner_approved_at && (
              <Button variant="secondary" loading={busy} onClick={() => rpc('unapprove_day', { p_sheet: id }, 'ปลดล็อกแล้ว')}>
                <Undo2 className="size-4" /> ปลดล็อก
              </Button>
            )}
          </div>
        </div>
        {!sheet.supervisor_approved_at && !isSup && (
          <p className={`mt-4 rounded-xl px-4 py-3 text-sm ${sheet.supervisor_id ? 'bg-slate-50 text-slate-600' : 'bg-amber-50 text-amber-800'}`}>
            {sheet.supervisor_id ? (
              <>
                รอ <b>{personName(sheet.supervisor_id)}</b> (หัวหน้างานของ{sheet.team_name}) เข้าระบบมาอนุมัติ — ผู้อื่นอนุมัติแทนไม่ได้
              </>
            ) : (
              <>
                <b>{sheet.team_name} ยังไม่ได้กำหนดหัวหน้างาน</b> จึงยังไม่มีใครอนุมัติได้ — แอดมินกำหนดได้ที่หน้าจ็อบ › แก้ไข › ช่องหัวหน้างาน
              </>
            )}
          </p>
        )}
        {sheet.reject_reason && !sheet.supervisor_approved_at && (
          <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <b>ถูกตีกลับโดย {personName(sheet.rejected_by)}:</b> {sheet.reject_reason}
          </p>
        )}
        {sheet.open_people > 0 && (
          <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            ยังมี {sheet.open_people} คนที่ไม่ได้เช็คเอาท์ — หัวหน้างานใส่เวลาออกแทนได้ (ต้องระบุเหตุผล)
          </p>
        )}
      </Card>

      <Card>
        <CardHeader
          title="เวลาเข้า-ออก"
          sub="ชั่วโมงคำนวณอัตโนมัติ: 8 ชม.แรกเป็นปกติ ส่วนเกินเป็น OT (ปัดลงทีละ 30 นาที)"
          right={
            <>
              {canAllow && rows.length > 0 && (
                <Button variant="secondary" size="sm" onClick={() => setAllow({ kind: KINDS[0], mode: 'each', amount: '', picked: [] })}>
                  <CircleDollarSign className="size-4" /> เพิ่ม Allowance
                </Button>
              )}
              {canEditTimes && notCame.length > 0 && (
                <Button variant="secondary" size="sm" onClick={() => setEditAtt({ worker_id: notCame[0].id, in: '08:00', out: '17:00', note: '' })}>
                  <Plus className="size-4" /> ลงเวลาแทน
                </Button>
              )}
            </>
          }
        />
        {/* มือถือ: แสดงเป็นการ์ด เห็นปุ่มแก้ไขครบโดยไม่ต้องเลื่อนตาราง */}
        <ul className="divide-y divide-slate-100 md:hidden">
          {sorted.map((r) => (
            <li key={r.id} className="space-y-2 px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{names.get(r.worker_id) ?? '…'}</p>
                  <p className="tabular text-sm text-slate-600">
                    {fmtTime(r.check_in)} → {r.check_out ? fmtOut(r.check_in, r.check_out) : <span className="text-amber-700">ยังไม่ออก</span>}
                  </p>
                  {r.source === 'supervisor' && <p className="text-xs text-amber-700">แก้โดยหัวหน้า{r.note ? `: ${r.note}` : ''}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1">{rowActions(r)}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge>{holiday ? '×2' : 'ปกติ'} {fmtHours(r.normal_h) || '0'} ชม.</Badge>
                {Number(r.ot_h) > 0 && <Badge tone="blue">{holiday ? 'OT ×3' : 'OT ×1.5'} {fmtHours(r.ot_h)} ชม.</Badge>}
                {allowView(r)}
              </div>
            </li>
          ))}
          <li className="flex justify-between bg-slate-50 px-4 py-2.5 text-sm font-semibold">
            <span>รวม</span>
            <span className="tabular">
              ปกติ {fmtHours(totals.n) || '0'} · OT {fmtHours(totals.ot) || '0'}
              {allowTotal > 0 && ` · ${fmtMoney(allowTotal)} ฿`}
            </span>
          </li>
        </ul>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-xs font-medium text-slate-500">
              <tr>
                <th className="px-5 py-2.5 text-left">ชื่อ</th>
                <th className="px-3 py-2.5">เข้า</th>
                <th className="px-3 py-2.5">ออก</th>
                <th className="px-3 py-2.5">{holiday ? '×2' : 'ปกติ'}</th>
                <th className="px-3 py-2.5">{holiday ? 'OT ×3' : 'OT ×1.5'}</th>
                <th className="px-3 py-2.5 text-left">Allowance</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((r) => (
                <tr key={r.id}>
                  <td className="px-5 py-3">
                    <p className="font-medium text-slate-900">{names.get(r.worker_id) ?? '…'}</p>
                    {r.source === 'supervisor' && (
                      <p className="text-xs text-amber-700" title={`แก้โดย ${personName(r.updated_by)} ${fmtDateTime(r.updated_at)}`}>
                        แก้โดยหัวหน้า{r.note ? `: ${r.note}` : ''}
                      </p>
                    )}
                  </td>
                  <td className="tabular px-3 py-3 text-center">{fmtTime(r.check_in)}</td>
                  <td className="tabular px-3 py-3 text-center">{r.check_out ? fmtOut(r.check_in, r.check_out) : <Badge tone="amber">ยังไม่ออก</Badge>}</td>
                  <td className="tabular px-3 py-3 text-center font-medium">{fmtHours(r.normal_h)}</td>
                  <td className="tabular px-3 py-3 text-center font-medium text-brand-700">{fmtHours(r.ot_h)}</td>
                  <td className="px-3 py-3">
                    {allowView(r)}
                  </td>
                  <td className="px-5 py-3">
                    {rowActions(r)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 text-sm font-semibold">
              <tr>
                <td className="px-5 py-2.5">รวม</td>
                <td colSpan={2} />
                <td className="tabular px-3 py-2.5 text-center">{fmtHours(totals.n) || '0'}</td>
                <td className="tabular px-3 py-2.5 text-center text-brand-700">{fmtHours(totals.ot) || '0'}</td>
                <td className="tabular px-3 py-2.5">{allowTotal > 0 && `${fmtMoney(allowTotal)} ฿`}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="เอกสาร: รายชื่อทีมงาน"
          sub={sheet.locked ? 'อนุมัติครบแล้ว' : 'ยังอนุมัติไม่ครบ เอกสารจะมีลายน้ำ "ร่าง"'}
          right={
            <Link to={`/print/day/${sheet.id}?auto=1`} target="_blank">
              <Button size="sm">
                <FileDown className="size-4" /> Export PDF
              </Button>
            </Link>
          }
        />
        <div className="p-5">
          <DayPreview id={sheet.id} version={`${sheet.supervisor_approved_at}|${sheet.planner_approved_at}|${rows.map((r) => r.updated_at).join()}`} />
        </div>
      </Card>

      <Modal
        open={Boolean(editAtt)}
        onClose={() => setEditAtt(null)}
        title={editAtt?.id ? 'แก้ไขเวลา' : 'ลงเวลาแทน'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditAtt(null)}>
              ยกเลิก
            </Button>
            <Button onClick={saveAtt} loading={busy}>
              บันทึก
            </Button>
          </>
        }
      >
        {editAtt && (
          <div className="space-y-4">
            {editAtt.id ? (
              <p className="font-medium">{names.get(editAtt.worker_id)}</p>
            ) : (
              <Field label="ชื่อ">
                <Select value={editAtt.worker_id} onChange={(e) => setEditAtt({ ...editAtt, worker_id: e.target.value })}>
                  {notCame.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.full_name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <div className="grid grid-cols-2 gap-4">
              <Field label="เวลาเข้า">
                <Input type="time" value={editAtt.in} onChange={(e) => setEditAtt({ ...editAtt, in: e.target.value })} />
              </Field>
              <Field label="เวลาออก" hint={editAtt.out && editAtt.in && editAtt.out <= editAtt.in ? `ออกวันถัดไป (${fmtDate(addDays(sheet.work_date, 1))}) — ทำงานข้ามเที่ยงคืน` : 'ถ้าออกหลังเที่ยงคืน ใส่เวลาได้เลย เช่น 01:00'}>
                <Input type="time" value={editAtt.out} onChange={(e) => setEditAtt({ ...editAtt, out: e.target.value })} />
              </Field>
            </div>
            <Field label="เหตุผล *" hint="บันทึกไว้ในประวัติ และแสดงให้ Planner เห็น">
              <Input placeholder="เช่น ลืมเช็คเอาท์ / มือถือแบตหมด" value={editAtt.note} onChange={(e) => setEditAtt({ ...editAtt, note: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={reject !== null}
        onClose={() => setReject(null)}
        title="ตีกลับให้หัวหน้างานแก้ไข"
        footer={
          <>
            <Button variant="secondary" onClick={() => setReject(null)}>
              ยกเลิก
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={async () => {
                await rpc('reject_day', { p_sheet: id, p_reason: reject }, 'ตีกลับแล้ว')
                setReject(null)
              }}
            >
              ตีกลับ
            </Button>
          </>
        }
      >
        <Field label="เหตุผล">
          <Textarea rows={3} autoFocus value={reject ?? ''} onChange={(e) => setReject(e.target.value)} />
        </Field>
      </Modal>

      <Modal
        open={Boolean(allow)}
        onClose={() => setAllow(null)}
        title="เพิ่ม Allowance"
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setAllow(null)}>
              ยกเลิก
            </Button>
            <Button onClick={saveAllow} loading={busy}>
              บันทึก
            </Button>
          </>
        }
      >
        {allow && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="ประเภท">
                <Select value={allow.kind} onChange={(e) => setAllow({ ...allow, kind: e.target.value })}>
                  {KINDS.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </Select>
              </Field>
              <Field label="วิธีคิด">
                <Select value={allow.mode} onChange={(e) => setAllow({ ...allow, mode: e.target.value as 'each' | 'split' })}>
                  <option value="each">คนละเท่ากัน</option>
                  <option value="split">ยอดรวม หารเท่า</option>
                </Select>
              </Field>
              <Field label={allow.mode === 'each' ? 'บาท / คน' : 'ยอดรวม (บาท)'}>
                <Input type="number" min={0} step="0.01" value={allow.amount} onChange={(e) => setAllow({ ...allow, amount: e.target.value })} />
              </Field>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700">เลือกคน ({allow.picked.length})</p>
                <button
                  className="text-sm text-brand-600 hover:underline"
                  onClick={() => setAllow({ ...allow, picked: allow.picked.length === rows.length ? [] : rows.map((r) => r.worker_id) })}
                >
                  {allow.picked.length === rows.length ? 'ไม่เลือกทั้งหมด' : 'เลือกทั้งหมด'}
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {sorted.map((r) => {
                  const on = allow.picked.includes(r.worker_id)
                  return (
                    <label key={r.worker_id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${on ? 'border-brand-400 bg-brand-50' : 'border-slate-200'}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setAllow({ ...allow, picked: on ? allow.picked.filter((x) => x !== r.worker_id) : [...allow.picked, r.worker_id] })}
                        className="size-4 accent-brand-600"
                      />
                      <span className="text-sm">{names.get(r.worker_id)}</span>
                    </label>
                  )
                })}
              </div>
            </div>
            <p className="text-xs text-slate-500">ถ้าแต่ละคนได้ไม่เท่ากัน บันทึกก่อนแล้วแก้ตัวเลขรายคนในตารางได้ · ใส่ 0 เพื่อลบ</p>
          </div>
        )}
      </Modal>
    </>
  )
}

function Step({ label, at, by }: { label: string; at: string | null; by: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={`flex size-8 items-center justify-center rounded-full ${at ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
        <Check className="size-4" />
      </div>
      <div>
        <p className="text-sm font-medium text-slate-900">{label}</p>
        <p className="text-xs text-slate-500">{at ? `${by} · ${fmtDateTime(at)}` : 'รออนุมัติ'}</p>
      </div>
    </div>
  )
}

function DayPreview({ id, version }: { id: string; version: string }) {
  const { data, error } = useLoad(() => loadDay(id), [id, version])
  if (error) return <ErrorBox message={error} />
  if (!data) return <Spinner />
  return (
    <DocPreview>
      <DayDoc data={data} />
    </DocPreview>
  )
}

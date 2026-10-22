import { ArrowLeft, Printer } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { Button } from '../components/ui'
import { must } from '../lib/hooks'
import { supabase } from '../lib/supabase'
import type { CostSheet, CostSnapshot } from '../lib/types'

export function PrintShell({ children, landscape, title }: { children: ReactNode; landscape?: boolean; title: string }) {
  // เปิดจากปุ่ม Export PDF (?auto=1) → เปิดหน้าต่างพิมพ์ให้เลือก "บันทึกเป็น PDF" อัตโนมัติ
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('auto') !== '1') return
    let cancelled = false
    document.fonts.ready.then(() => setTimeout(() => !cancelled && window.print(), 500))
    return () => {
      cancelled = true
    }
  }, [])
  return (
    <div className="min-h-screen bg-slate-200 print:bg-white">
      <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-300 bg-white px-4 py-3">
        <button onClick={() => window.close()} className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft className="size-4" /> ปิด
        </button>
        <p className="truncate text-sm font-medium text-slate-700">{title}</p>
        <Button onClick={() => window.print()}>
          <Printer className="size-4" /> พิมพ์ / บันทึก PDF
        </Button>
      </div>
      <div className={landscape ? 'landscape' : ''}>{children}</div>
    </div>
  )
}

/** กระดาษ A4 บนหน้าจอ (ตอนพิมพ์จะใช้ขนาดจริงจาก @page) */
export function Paper({ children, landscape, className = '' }: { children: ReactNode; landscape?: boolean; className?: string }) {
  return (
    <div
      className={`doc relative my-6 overflow-hidden p-[10mm] shadow-lg print:my-0 print:overflow-visible ${className}`}
      style={{ width: landscape ? '297mm' : '210mm', minHeight: landscape ? '210mm' : '297mm' }}
    >
      {children}
    </div>
  )
}

export function DraftMark({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span className="-rotate-12 rounded-xl border-4 border-rose-300 px-8 py-2 text-5xl font-bold text-rose-300/70">ร่าง · ยังไม่อนุมัติ</span>
    </div>
  )
}

export function DocHeader({ company, right }: { company: string; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-4">
      <div className="flex items-center gap-4">
        <img src={`${import.meta.env.BASE_URL}brand/osa-logo.png`} alt="OSA" style={{ height: '16mm' }} />
        <div className="text-[11px] leading-tight">
          <p className="font-semibold">{company}</p>
        </div>
      </div>
      {right}
    </div>
  )
}

/** รูปลายเซ็นที่ติดอยู่กับเอกสาร (ฐานข้อมูลให้เห็นเฉพาะของเอกสารที่ตัวเองมีสิทธิ์ดู) */
export async function loadSigs(ids: (string | null | undefined)[]) {
  const want = [...new Set(ids.filter(Boolean) as string[])]
  if (!want.length) return new Map<string, string>()
  const rows = must(await supabase.from('signatures').select('id, png').in('id', want)) as { id: string; png: string }[]
  return new Map(rows.map((r) => [r.id, r.png]))
}

export async function loadCost(id: string) {
  const cs = must(await supabase.from('cost_sheets').select('*').eq('id', id).single()) as CostSheet
  const snap =
    cs.status === 'draft'
      ? (must(await supabase.rpc('cost_preview', { p_job: cs.job_id, p_from: cs.period_from, p_to: cs.period_to })) as CostSnapshot)
      : (cs.snapshot as CostSnapshot)
  const [appr, people, teams, days] = await Promise.all([
    supabase.from('cost_sheet_approvals').select('supervisor_id, approved_at, sig_id, approver_name').eq('cost_sheet_id', id),
    supabase.from('profiles').select('id, full_name, email'),
    supabase.from('teams').select('supervisor_id').eq('job_id', cs.job_id),
    supabase.from('day_sheets').select('planner_approved_by, planner_approved_at, planner_sig_id, planner_name').eq('job_id', cs.job_id)
      .gte('work_date', cs.period_from).lte('work_date', cs.period_to).not('planner_approved_by', 'is', null),
  ])
  const ppl = must(people) as { id: string; full_name: string; email: string }[]
  const name = (uid: string | null) => {
    const p = ppl.find((x) => x.id === uid)
    return p?.full_name || p?.email || ''
  }
  // ชื่อและลายเซ็นใช้ตามที่บันทึกไว้ตอนอนุมัติ (เปลี่ยนโปรไฟล์ทีหลัง เอกสารไม่เปลี่ยนตาม)
  type PlannerDay = { planner_approved_by: string; planner_approved_at: string; planner_sig_id: string | null; planner_name: string | null }
  const plannerMap = new Map<string, PlannerDay>()
  for (const d of must(days) as PlannerDay[]) {
    const prev = plannerMap.get(d.planner_approved_by)
    if (!prev || d.planner_approved_at > prev.planner_approved_at) plannerMap.set(d.planner_approved_by, d)
  }
  const supIds = [...new Set((must(teams) as { supervisor_id: string | null }[]).map((t) => t.supervisor_id).filter(Boolean) as string[])]
  const approvals = must(appr) as { supervisor_id: string; approved_at: string; sig_id: string | null; approver_name: string | null }[]
  const sigs = await loadSigs([cs.submitted_sig_id, ...approvals.map((a) => a.sig_id), ...[...plannerMap.values()].map((d) => d.planner_sig_id)])
  const sig = (sid: string | null | undefined) => (sid ? (sigs.get(sid) ?? null) : null)
  return {
    cs,
    snap,
    name,
    purchaser: cs.submitted_by
      ? { id: cs.submitted_by, name: cs.submitted_name || name(cs.submitted_by), at: cs.submitted_at, sig: sig(cs.submitted_sig_id) }
      : null,
    supervisors: supIds.map((s) => {
      const a = approvals.find((x) => x.supervisor_id === s)
      return { id: s, name: a?.approver_name || name(s), at: a?.approved_at ?? null, sig: sig(a?.sig_id) }
    }),
    planners: [...plannerMap.entries()].map(([pid, d]) => ({
      id: pid,
      name: d.planner_name || name(pid),
      at: d.planner_approved_at,
      sig: sig(d.planner_sig_id),
    })),
  }
}

export function SignBox({ label, name, date, note, signature, signatures }: { label: string; name?: string; date?: string; note?: string; signature?: string | null; signatures?: (string | null | undefined)[] }) {
  const sigs = (signatures ?? [signature]).filter(Boolean) as string[]
  return (
    <div className="flex-1 border border-black p-2 text-center text-[10px]" style={{ breakInside: 'avoid' }}>
      <p className="text-left">{label}</p>
      <div className="flex h-[13mm] items-end justify-center">
        {sigs.map((s, i) => (
          <img key={i} src={s} alt="" className="max-h-[13mm] object-contain" style={{ maxWidth: `${100 / sigs.length}%` }} />
        ))}
      </div>
      <p className="min-h-5 font-semibold">{name ? `(${name})` : ''}</p>
      {note && <p className="text-[9px] text-emerald-700">{note}</p>}
      <p className="mt-1 border-t border-dashed border-black pt-1">วันที่ / Date {date}</p>
    </div>
  )
}

import { ArrowLeft, Printer } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '../components/ui'
import { must } from '../lib/hooks'
import { supabase } from '../lib/supabase'
import type { CostSheet, CostSnapshot } from '../lib/types'

export function PrintShell({ children, landscape, title }: { children: ReactNode; landscape?: boolean; title: string }) {
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

export async function loadCost(id: string) {
  const cs = must(await supabase.from('cost_sheets').select('*').eq('id', id).single()) as CostSheet
  const snap =
    cs.status === 'draft'
      ? (must(await supabase.rpc('cost_preview', { p_job: cs.job_id, p_from: cs.period_from, p_to: cs.period_to })) as CostSnapshot)
      : (cs.snapshot as CostSnapshot)
  const [appr, people, teams] = await Promise.all([
    supabase.from('cost_sheet_approvals').select('supervisor_id, approved_at').eq('cost_sheet_id', id),
    supabase.from('profiles').select('id, full_name, email'),
    supabase.from('teams').select('supervisor_id').eq('job_id', cs.job_id),
  ])
  const ppl = must(people) as { id: string; full_name: string; email: string }[]
  const name = (uid: string | null) => {
    const p = ppl.find((x) => x.id === uid)
    return p?.full_name || p?.email || ''
  }
  const supIds = [...new Set((must(teams) as { supervisor_id: string | null }[]).map((t) => t.supervisor_id).filter(Boolean) as string[])]
  const approvals = must(appr) as { supervisor_id: string; approved_at: string }[]
  return {
    cs,
    snap,
    name,
    supervisors: supIds.map((s) => ({ id: s, name: name(s), at: approvals.find((a) => a.supervisor_id === s)?.approved_at ?? null })),
  }
}

export function SignBox({ label, name, date, note }: { label: string; name?: string; date?: string; note?: string }) {
  return (
    <div className="flex-1 border border-black p-2 text-center text-[10px]">
      <p className="text-left">{label}</p>
      <p className="mt-4 min-h-5 font-semibold">{name}</p>
      {note && <p className="text-[9px] text-emerald-700">{note}</p>}
      <p className="mt-1 border-t border-dashed border-black pt-1">วันที่ / Date {date}</p>
    </div>
  )
}

import { Badge } from '../components/ui'
import type { CostSheet, DaySheet } from './types'

export function dayStatus(d: Pick<DaySheet, 'locked' | 'supervisor_approved_at' | 'planner_approved_at' | 'reject_reason' | 'open_people'>) {
  if (d.locked) return { tone: 'green' as const, label: 'อนุมัติครบ' }
  if (d.reject_reason && !d.supervisor_approved_at) return { tone: 'red' as const, label: 'ถูกตีกลับ' }
  if (d.supervisor_approved_at) return { tone: 'blue' as const, label: 'รอ Planner' }
  if (d.open_people > 0) return { tone: 'violet' as const, label: `ยังไม่ออก ${d.open_people} คน` }
  return { tone: 'amber' as const, label: 'รอหัวหน้างาน' }
}

export function DayBadge({ d }: { d: Parameters<typeof dayStatus>[0] }) {
  const s = dayStatus(d)
  return <Badge tone={s.tone}>{s.label}</Badge>
}

export function costStatus(c: Pick<CostSheet, 'status' | 'reject_reason'>) {
  if (c.status === 'approved') return { tone: 'green' as const, label: 'อนุมัติแล้ว' }
  if (c.status === 'submitted') return { tone: 'amber' as const, label: 'รอหัวหน้างานอนุมัติ' }
  if (c.reject_reason) return { tone: 'red' as const, label: 'ถูกตีกลับ' }
  return { tone: 'gray' as const, label: 'ร่าง' }
}

export function CostBadge({ c }: { c: Parameters<typeof costStatus>[0] }) {
  const s = costStatus(c)
  return <Badge tone={s.tone}>{s.label}</Badge>
}

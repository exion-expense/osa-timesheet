import { useEffect, useState } from 'react'
import { todayYmd } from './format'
import { supabase } from './supabase'
import type { Role } from './types'

/** หน้าแรกหลังล็อกอินของแต่ละตำแหน่ง */
export function roleHome(role: Role | null | undefined) {
  switch (role) {
    case 'supervisor':
      return '/today'
    case 'planner':
      return '/inbox'
    case 'purchase':
      return '/costs'
    default:
      return '/'
  }
}

/** ตัวเลขงานค้างของผู้ใช้คนนี้ สำหรับป้ายบนเมนู (อัปเดตทุก 60 วินาที) */
export function usePendingCounts(role: Role | null | undefined, userId: string | undefined) {
  const [counts, setCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!role || !userId) return
    let alive = true
    const load = async () => {
      const next: Record<string, number> = {}
      const { data } = await supabase.rpc('dashboard')
      if (data) {
        const d = data as { pending_days_supervisor: number; pending_days_planner: number; cost_drafts: number; cost_waiting: number }
        if (role === 'supervisor') next['/inbox'] = d.pending_days_supervisor + d.cost_waiting
        if (role === 'planner') next['/inbox'] = d.pending_days_planner
        if (role === 'admin') next['/inbox'] = d.pending_days_supervisor + d.pending_days_planner
        if (role === 'purchase' || role === 'admin') next['/costs'] = d.cost_drafts
      }
      if (role === 'supervisor' || role === 'admin') {
        const today = todayYmd()
        const [teams, sheets] = await Promise.all([
          supabase.from('teams').select('id, supervisor_id, jobs!inner(status, start_date, end_date)').eq('jobs.status', 'active').lte('jobs.start_date', today).gte('jobs.end_date', today),
          supabase.from('day_sheets').select('team_id, opened_at').eq('work_date', today),
        ])
        const opened = new Set((sheets.data ?? []).filter((s) => s.opened_at).map((s) => s.team_id))
        const mine = (teams.data ?? []).filter((t) => role === 'admin' || t.supervisor_id === userId)
        next['/today'] = mine.filter((t) => !opened.has(t.id)).length
      }
      if (alive) setCounts(next)
    }
    load()
    const t = setInterval(load, 60000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [role, userId])
  return counts
}

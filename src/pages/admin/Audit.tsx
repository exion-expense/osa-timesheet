import { useState } from 'react'
import { Forbidden } from '../../components/Guards'
import { Badge, Card, ErrorBox, PageHeader, Select, Spinner } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { fmtDateTime } from '../../lib/format'
import { must, useLoad } from '../../lib/hooks'
import { supabase } from '../../lib/supabase'

const TABLES: Record<string, string> = {
  attendance: 'เวลาเข้า-ออก',
  day_sheets: 'อนุมัติรายวัน',
  allowances: 'Allowance',
  worker_rates: 'ค่าแรง',
  cost_sheets: 'ใบคิดราคา',
  cost_sheet_approvals: 'อนุมัติราคา',
  workers: 'ลูกทีม',
  teams: 'ทีม',
  jobs: 'จ็อบ',
  profiles: 'ผู้ใช้',
  app_settings: 'ตั้งค่า',
  holidays: 'วันหยุด',
}
const ACT: Record<string, { t: string; tone: 'green' | 'amber' | 'red' }> = {
  INSERT: { t: 'เพิ่ม', tone: 'green' },
  UPDATE: { t: 'แก้ไข', tone: 'amber' },
  DELETE: { t: 'ลบ', tone: 'red' },
}
const SKIP = new Set(['updated_at', 'created_at'])

type Row = { id: number; at: string; actor: string | null; table_name: string; row_id: string; action: string; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null }

export default function Audit() {
  const { is } = useAuth()
  const [table, setTable] = useState('')
  const { data, error, loading, reload } = useLoad(async () => {
    let q = supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(300)
    if (table) q = q.eq('table_name', table)
    const [rows, people] = await Promise.all([q, supabase.from('profiles').select('id, full_name, email')])
    return { rows: must(rows) as Row[], people: must(people) as { id: string; full_name: string; email: string }[] }
  }, [table])
  if (!is('admin')) return <Forbidden />

  const who = (id: string | null) => {
    if (!id) return 'ผู้รับเหมา (QR)'
    const p = data?.people.find((x) => x.id === id)
    return p?.full_name || p?.email || id.slice(0, 8)
  }
  const diff = (r: Row) => {
    if (r.action !== 'UPDATE' || !r.old_data || !r.new_data) return null
    return Object.keys(r.new_data)
      .filter((k) => !SKIP.has(k) && JSON.stringify(r.old_data![k]) !== JSON.stringify(r.new_data![k]))
      .map((k) => `${k}: ${fmt(r.old_data![k])} → ${fmt(r.new_data![k])}`)
      .join(' · ')
  }

  return (
    <>
      <PageHeader
        title="ประวัติการแก้ไข"
        sub="บันทึกทุกการเปลี่ยนแปลงข้อมูลสำคัญ (แก้ไขหรือลบไม่ได้) — แสดง 300 รายการล่าสุด"
        right={
          <Select value={table} onChange={(e) => setTable(e.target.value)} className="w-48">
            <option value="">ทุกประเภท</option>
            {Object.entries(TABLES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        }
      />
      {loading && !data ? (
        <Spinner />
      ) : error || !data ? (
        <ErrorBox message={error ?? ''} onRetry={reload} />
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100 text-sm">
            {data.rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-5 py-3">
                <span className="tabular w-32 shrink-0 text-slate-500">{fmtDateTime(r.at)}</span>
                <Badge tone={ACT[r.action]?.tone}>{ACT[r.action]?.t}</Badge>
                <span className="font-medium text-slate-900">{TABLES[r.table_name] ?? r.table_name}</span>
                <span className="text-slate-600">โดย {who(r.actor)}</span>
                {diff(r) && <span className="w-full break-all pl-36 text-xs text-slate-500">{diff(r)}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}

function fmt(v: unknown) {
  if (v === null || v === undefined) return '∅'
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 40 ? s.slice(0, 40) + '…' : s
}

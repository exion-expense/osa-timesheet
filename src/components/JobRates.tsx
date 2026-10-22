import { useState } from 'react'
import { fmtMoney } from '../lib/format'
import { must, useLoad } from '../lib/hooks'
import { supabase } from '../lib/supabase'
import { Badge, Button, Card, CardHeader, ErrorBox, Input, Spinner, useToast } from './ui'

type Row = {
  id: string
  full_name: string
  position: string
  active: boolean
  team_id: string
  teams: { name: string } | null
  worker_rates: { day_rate: number } | { day_rate: number }[] | null
}

const rateOf = (r: Row) => {
  const x = Array.isArray(r.worker_rates) ? r.worker_rates[0] : r.worker_rates
  return x ? Number(x.day_rate) : null
}

/** ค่าแรงรายคน — Purchase ใส่ได้ตั้งแต่แอดมินสร้างจ็อบและแบ่งทีม */
export function JobRates({ jobId, canEdit, onChanged }: { jobId: string; canEdit: boolean; onChanged?: () => void }) {
  const toast = useToast()
  const [all, setAll] = useState('')
  const { data, error, reload } = useLoad(
    async () =>
      must(
        await supabase.from('workers').select('id, full_name, position, active, team_id, teams(name), worker_rates(day_rate)').eq('job_id', jobId).order('full_name'),
      ) as unknown as Row[],
    [jobId],
  )
  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (!data) return <Spinner />

  const rows = data.filter((r) => r.active || rateOf(r) != null)
  const missing = rows.filter((r) => r.active && !rateOf(r))
  const teams = [...new Set(rows.map((r) => r.teams?.name ?? ''))].sort()

  async function save(workerId: string, v: string) {
    const n = Number(v)
    if (v.trim() === '' || !(n >= 0)) return toast.err('ค่าแรงไม่ถูกต้อง')
    const { error } = await supabase.from('worker_rates').upsert({ worker_id: workerId, day_rate: n })
    if (error) return toast.err(error)
    reload()
    onChanged?.()
  }

  async function fillAll() {
    const n = Number(all)
    if (!(n > 0)) return toast.err('ใส่ค่าแรงต่อวัน')
    if (!missing.length) return
    const { error } = await supabase.from('worker_rates').upsert(missing.map((r) => ({ worker_id: r.id, day_rate: n })))
    if (error) return toast.err(error)
    toast.ok(`ใส่ค่าแรงให้ ${missing.length} คน`)
    setAll('')
    reload()
    onChanged?.()
  }

  return (
    <Card>
      <CardHeader
        title="ค่าแรงรายคน (บาท/วัน)"
        sub={canEdit ? 'ใส่ได้ตั้งแต่สร้างจ็อบ — คนที่เพิ่มเข้าทีมทีหลังจะขึ้นสีเหลืองให้ใส่เพิ่ม' : 'กำหนดโดย Purchase'}
        right={
          canEdit &&
          missing.length > 0 && (
            <div className="flex items-center gap-2">
              <Input type="number" min={0} step="1" value={all} onChange={(e) => setAll(e.target.value)} placeholder="ค่าแรง/วัน" className="w-28" />
              <Button size="sm" variant="secondary" onClick={fillAll}>
                ใส่ให้ทุกคนที่ว่าง ({missing.length})
              </Button>
            </div>
          )
        }
      />
      {rows.length === 0 ? (
        <p className="p-5 text-sm text-slate-500">ยังไม่มีรายชื่อในจ็อบนี้</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {teams.map((t) => (
            <div key={t}>
              <p className="bg-slate-50 px-5 py-2 text-xs font-semibold text-slate-500">{t}</p>
              <ul className="divide-y divide-slate-100">
                {rows
                  .filter((r) => (r.teams?.name ?? '') === t)
                  .map((r) => {
                    const rate = rateOf(r)
                    return (
                      <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">{r.full_name}</p>
                          <p className="text-xs text-slate-500">
                            {r.position}
                            {!r.active && ' · ออกจากทีมแล้ว'}
                          </p>
                        </div>
                        {canEdit ? (
                          <input
                            type="number"
                            min={0}
                            step="1"
                            defaultValue={rate ?? ''}
                            key={`${r.id}-${rate}`}
                            aria-label={`ค่าแรงต่อวัน ${r.full_name}`}
                            onBlur={(e) => e.target.value !== String(rate ?? '') && save(r.id, e.target.value)}
                            className={`tabular w-28 rounded-lg border px-2 py-1.5 text-right ${rate ? 'border-slate-300' : 'border-amber-400 bg-amber-50'}`}
                            placeholder="ยังไม่ใส่"
                          />
                        ) : rate ? (
                          <span className="tabular">{fmtMoney(rate)}</span>
                        ) : (
                          <Badge tone="amber">ยังไม่ใส่</Badge>
                        )}
                      </li>
                    )
                  })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

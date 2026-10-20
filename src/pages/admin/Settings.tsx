import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Forbidden } from '../../components/Guards'
import { Button, Card, CardHeader, ErrorBox, Field, Input, PageHeader, Select, Spinner, useToast } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { fmtDateLong } from '../../lib/format'
import { must, useLoad } from '../../lib/hooks'
import { supabase } from '../../lib/supabase'

interface Settings {
  normal_hours: number
  lunch_start: string
  lunch_end: string
  evening_break_minutes: number
  round_minutes: number
  grace_minutes: number
  wht_rate: number
  pin_max_attempts: number
  require_mfa: boolean
  company_name: string
}

export default function SettingsPage() {
  const { is } = useAuth()
  const toast = useToast()
  const [s, setS] = useState<Settings | null>(null)
  const [busy, setBusy] = useState(false)
  const [hol, setHol] = useState({ holiday_date: '', name: '' })
  const { data, error, loading, reload } = useLoad(async () => {
    const [st, hs] = await Promise.all([
      supabase.from('app_settings').select('*').eq('id', 1).single(),
      supabase.from('holidays').select('*').order('holiday_date'),
    ])
    return { st: must(st) as Settings, hs: must(hs) as { holiday_date: string; name: string }[] }
  }, [])
  useEffect(() => {
    if (data) setS(data.st)
  }, [data])

  if (!is('admin')) return <Forbidden />
  if ((loading && !data) || !s) return error ? <ErrorBox message={error} onRetry={reload} /> : <Spinner />

  async function save() {
    if (!s) return
    setBusy(true)
    const { error } = await supabase
      .from('app_settings')
      .update({ ...s, lunch_start: s.lunch_start.slice(0, 5), lunch_end: s.lunch_end.slice(0, 5), updated_at: new Date().toISOString() })
      .eq('id', 1)
    setBusy(false)
    if (error) return toast.err(error)
    toast.ok('บันทึกการตั้งค่าแล้ว')
    reload()
  }

  async function addHoliday() {
    if (!hol.holiday_date || !hol.name.trim()) return toast.err('ใส่วันที่และชื่อวันหยุด')
    const { error } = await supabase.from('holidays').upsert({ holiday_date: hol.holiday_date, name: hol.name.trim() })
    if (error) return toast.err(error)
    setHol({ holiday_date: '', name: '' })
    reload()
  }
  async function delHoliday(d: string) {
    const { error } = await supabase.from('holidays').delete().eq('holiday_date', d)
    if (error) return toast.err(error)
    reload()
  }

  const num = (k: keyof Settings) => (e: { target: { value: string } }) => setS({ ...s, [k]: Number(e.target.value) })

  return (
    <>
      <PageHeader title="ตั้งค่า" right={<Button onClick={save} loading={busy}>บันทึก</Button>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="การคำนวณชั่วโมง" sub="มีผลกับการคำนวณทุกจ็อบ (ใบที่ส่งอนุมัติแล้วไม่เปลี่ยน)" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="ชั่วโมงปกติต่อวัน">
              <Input type="number" min={1} max={12} step="0.5" value={s.normal_hours} onChange={num('normal_hours')} />
            </Field>
            <Field label="พักเย็นก่อน OT (นาที)" hint="ใช้เมื่อจ็อบติ๊กว่ามีพัก">
              <Input type="number" min={0} max={180} value={s.evening_break_minutes} onChange={num('evening_break_minutes')} />
            </Field>
            <Field label="พักเที่ยงเริ่ม">
              <Input type="time" value={s.lunch_start.slice(0, 5)} onChange={(e) => setS({ ...s, lunch_start: e.target.value })} />
            </Field>
            <Field label="พักเที่ยงสิ้นสุด">
              <Input type="time" value={s.lunch_end.slice(0, 5)} onChange={(e) => setS({ ...s, lunch_end: e.target.value })} />
            </Field>
            <Field label="ปัดชั่วโมงลงทีละ">
              <Select value={s.round_minutes} onChange={num('round_minutes')}>
                {[1, 5, 10, 15, 30, 60].map((m) => (
                  <option key={m} value={m}>
                    {m} นาที
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="เผื่อ (นาที)" hint="เช่น สาย 3 นาทียังได้ครบ 8 ชม.">
              <Input type="number" min={0} max={29} value={s.grace_minutes} onChange={num('grace_minutes')} />
            </Field>
          </div>
        </Card>
        <Card>
          <CardHeader title="เอกสารและความปลอดภัย" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="ชื่อบริษัท (หัวเอกสาร)" className="sm:col-span-2">
              <Input value={s.company_name} onChange={(e) => setS({ ...s, company_name: e.target.value })} />
            </Field>
            <Field label="หัก ณ ที่จ่าย (%)">
              <Input type="number" min={0} max={100} step="0.01" value={s.wht_rate} onChange={num('wht_rate')} />
            </Field>
            <Field label="กรอก PIN ผิดได้ (ครั้ง)">
              <Input type="number" min={3} max={10} value={s.pin_max_attempts} onChange={num('pin_max_attempts')} />
            </Field>
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={s.require_mfa} onChange={(e) => setS({ ...s, require_mfa: e.target.checked })} className="mt-0.5 size-4 accent-brand-600" />
              <span>
                บังคับรหัส 2 ชั้น (Authenticator) สำหรับแอดมินและ Purchase
                <span className="block text-xs text-slate-500">แนะนำให้เปิดไว้เสมอ</span>
              </span>
            </label>
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="วันหยุดนักขัตฤกษ์ / วันหยุดบริษัท" sub="วันในรายการนี้คิดเป็นวันหยุด (×2 และ OT ×3) เพิ่มวันหยุดทางศาสนาและวันหยุดชดเชยตามประกาศบริษัทแต่ละปี" />
          <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-5">
            <Field label="วันที่">
              <Input type="date" value={hol.holiday_date} onChange={(e) => setHol({ ...hol, holiday_date: e.target.value })} />
            </Field>
            <Field label="ชื่อวันหยุด" className="min-w-56 flex-1">
              <Input value={hol.name} onChange={(e) => setHol({ ...hol, name: e.target.value })} placeholder="เช่น วันวิสาขบูชา" />
            </Field>
            <Button onClick={addHoliday}>
              <Plus className="size-4" /> เพิ่ม
            </Button>
          </div>
          <ul className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0">
            {data?.hs.map((h) => (
              <li key={h.holiday_date} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <span>
                  <span className="font-medium text-slate-900">{fmtDateLong(h.holiday_date)}</span> <span className="text-slate-500">· {h.name}</span>
                </span>
                <button onClick={() => delHoliday(h.holiday_date)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600" title="ลบ">
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  )
}

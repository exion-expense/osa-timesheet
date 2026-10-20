import { Info, Pencil } from 'lucide-react'
import { useState } from 'react'
import { Forbidden } from '../../components/Guards'
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, useToast } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { fmtDate } from '../../lib/format'
import { must, useLoad } from '../../lib/hooks'
import { supabase } from '../../lib/supabase'
import { ROLE_LABEL, type Profile, type Role } from '../../lib/types'

export default function Users() {
  const { is, profile: me } = useAuth()
  const toast = useToast()
  const [edit, setEdit] = useState<Profile | null>(null)
  const [busy, setBusy] = useState(false)
  const { data, error, loading, reload } = useLoad(
    async () => must(await supabase.from('profiles').select('*').order('role', { nullsFirst: true }).order('full_name')) as Profile[],
    [],
  )
  if (!is('admin')) return <Forbidden />
  if (loading && !data) return <Spinner />
  if (error || !data) return <ErrorBox message={error ?? ''} onRetry={reload} />

  async function save() {
    if (!edit) return
    setBusy(true)
    const { error } = await supabase.from('profiles').update({ full_name: edit.full_name.trim(), role: edit.role, active: edit.active }).eq('id', edit.id)
    setBusy(false)
    if (error) return toast.err(error)
    toast.ok('บันทึกแล้ว')
    setEdit(null)
    reload()
  }

  return (
    <>
      <PageHeader title="ผู้ใช้งาน" sub="กำหนดตำแหน่งและสิทธิ์ของพนักงาน" />
      <div className="mb-6 flex gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm text-brand-800">
        <Info className="mt-0.5 size-5 shrink-0" />
        <div>
          <p className="font-medium">วิธีเพิ่มผู้ใช้ใหม่</p>
          <p className="mt-1">
            Supabase Dashboard → Authentication → Users → <b>Add user → Create new user</b> ใส่อีเมลและรหัสผ่านชั่วคราว ติ๊ก <b>Auto Confirm User</b>
            → แจ้งรหัสชั่วคราวให้ผู้ใช้เป็นการส่วนตัว → กลับมาหน้านี้แล้วกำหนดตำแหน่ง → ผู้ใช้เข้าระบบแล้วกดไอคอนกุญแจเพื่อเปลี่ยนรหัสผ่านเอง
          </p>
        </div>
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
              <tr>
                <th className="px-5 py-2.5">ชื่อ</th>
                <th className="px-3 py-2.5">อีเมล</th>
                <th className="px-3 py-2.5">ตำแหน่ง</th>
                <th className="px-3 py-2.5">สร้างเมื่อ</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((p) => (
                <tr key={p.id} className={p.active ? '' : 'text-slate-400'}>
                  <td className="px-5 py-3 font-medium">{p.full_name || '—'}</td>
                  <td className="px-3 py-3">{p.email}</td>
                  <td className="px-3 py-3">
                    {!p.active ? <Badge>ปิดใช้งาน</Badge> : p.role ? <Badge tone="blue">{ROLE_LABEL[p.role]}</Badge> : <Badge tone="amber">รอกำหนด</Badge>}
                  </td>
                  <td className="px-3 py-3">{fmtDate(p.created_at)}</td>
                  <td className="px-5 py-3 text-right">
                    {p.id !== me?.id && (
                      <button onClick={() => setEdit(p)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="แก้ไข">
                        <Pencil className="size-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={Boolean(edit)}
        onClose={() => setEdit(null)}
        title="แก้ไขผู้ใช้"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEdit(null)}>
              ยกเลิก
            </Button>
            <Button onClick={save} loading={busy}>
              บันทึก
            </Button>
          </>
        }
      >
        {edit && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">{edit.email}</p>
            <Field label="ชื่อที่แสดง">
              <Input value={edit.full_name} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} />
            </Field>
            <Field label="ตำแหน่ง" hint="แอดมินและ Purchase ต้องใช้รหัส 2 ชั้นจากแอป Authenticator">
              <Select value={edit.role ?? ''} onChange={(e) => setEdit({ ...edit, role: (e.target.value || null) as Role | null })}>
                <option value="">— ไม่มีสิทธิ์ —</option>
                {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} className="size-4 accent-brand-600" />
              เปิดใช้งาน
            </label>
          </div>
        )}
      </Modal>
    </>
  )
}

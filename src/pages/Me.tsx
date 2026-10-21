import { KeyRound, PenLine, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ChangePassword } from '../components/ChangePassword'
import { Button, Card, CardHeader, Field, Input, PageHeader, useToast } from '../components/ui'
import { useAuth } from '../lib/auth'
import { processSignature } from '../lib/signature'
import { errMsg, supabase } from '../lib/supabase'
import { ROLE_LABEL } from '../lib/types'

/** บัญชีของฉัน: ชื่อจริง (แสดงในเอกสาร), ลายเซ็น, เปลี่ยนรหัสผ่าน */
export default function Me() {
  const { profile, refresh } = useAuth()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [sig, setSig] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)

  useEffect(() => {
    if (!profile) return
    setName(profile.full_name)
    setSig(profile.signature_png ?? null)
    setDirty(false)
  }, [profile])

  async function onFile(f?: File) {
    if (!f) return
    setBusy(true)
    try {
      setSig(await processSignature(f))
      setDirty(true)
    } catch (e) {
      toast.err(errMsg(e))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function save() {
    if (!profile) return
    if (name.trim().length < 2) return toast.err('กรุณากรอกชื่อ-นามสกุล')
    setBusy(true)
    const { error } = await supabase.from('profiles').update({ full_name: name.trim(), signature_png: sig }).eq('id', profile.id)
    setBusy(false)
    if (error) return toast.err(error)
    toast.ok('บันทึกแล้ว')
    await refresh()
  }

  if (!profile) return null
  return (
    <>
      <PageHeader title="บัญชีของฉัน" sub={`${profile.email} · ${profile.role ? ROLE_LABEL[profile.role] : ''}`} />
      <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="ชื่อที่แสดงในเอกสาร" sub="ใช้ในช่องลงนาม Time Sheet และสรุปค่าแรง" />
          <div className="space-y-4 p-5">
            <Field label="ชื่อ-นามสกุล">
              <Input
                maxLength={120}
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setDirty(true)
                }}
                placeholder="เช่น สมชาย ใจดี"
              />
            </Field>
            <Button variant="secondary" onClick={() => setPwOpen(true)}>
              <KeyRound className="size-4" /> เปลี่ยนรหัสผ่าน
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="ลายเซ็น" sub="ขึ้นในเอกสารเฉพาะเมื่อคุณกดอนุมัติในระบบแล้วเท่านั้น" />
          <div className="space-y-4 p-5">
            <div className="flex h-36 items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-[repeating-linear-gradient(45deg,#f8fafc,#f8fafc_10px,#f1f5f9_10px,#f1f5f9_20px)]">
              {sig ? (
                <img src={sig} alt="ลายเซ็น" className="max-h-28 max-w-full" />
              ) : (
                <p className="flex items-center gap-2 text-sm text-slate-400">
                  <PenLine className="size-4" /> ยังไม่มีลายเซ็น
                </p>
              )}
            </div>
            <p className="text-xs text-slate-500">
              เซ็นด้วยปากกาสีเข้มบนกระดาษขาว แล้วถ่ายรูปให้ชัด ระบบจะลบพื้นหลังและครอปให้อัตโนมัติ
            </p>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => fileRef.current?.click()} loading={busy}>
                <Upload className="size-4" /> {sig ? 'เปลี่ยนรูปลายเซ็น' : 'อัปโหลดรูปลายเซ็น'}
              </Button>
              {sig && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSig(null)
                    setDirty(true)
                  }}
                >
                  <Trash2 className="size-4" /> ลบ
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>
      <div className="mt-6 max-w-4xl">
        <Button onClick={save} loading={busy} disabled={!dirty}>
          บันทึก
        </Button>
      </div>
      <ChangePassword open={pwOpen} onClose={() => setPwOpen(false)} />
    </>
  )
}

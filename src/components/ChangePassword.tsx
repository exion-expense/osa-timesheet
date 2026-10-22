import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { errMsg, supabase } from '../lib/supabase'
import { Button, Field, Input, Modal, useToast } from './ui'

/** เปลี่ยนรหัสผ่านของตัวเอง (ใช้หลังแอดมินสร้างบัญชีด้วยรหัสชั่วคราว) */
export function ChangePassword({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const { session } = useAuth()
  const [cur, setCur] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const strong = pw.length >= 10 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw)

  async function save() {
    setError(null)
    if (!strong) return setError('อย่างน้อย 10 ตัว มีตัวพิมพ์เล็ก ตัวพิมพ์ใหญ่ และตัวเลข')
    if (pw !== pw2) return setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน')
    const email = session?.user.email
    if (!email || !cur) return setError('กรุณากรอกรหัสผ่านปัจจุบัน')
    setBusy(true)
    // ยืนยันรหัสเดิมก่อน: คนที่หยิบเครื่องที่ล็อกอินค้างไว้ เปลี่ยนรหัสยึดบัญชีไม่ได้
    const check = await supabase.auth.signInWithPassword({ email, password: cur })
    if (check.error) {
      setBusy(false)
      return setError(/Invalid login credentials/i.test(check.error.message) ? 'รหัสผ่านปัจจุบันไม่ถูกต้อง' : errMsg(check.error))
    }
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) return setError(errMsg(error))
    toast.ok('เปลี่ยนรหัสผ่านแล้ว')
    setCur('')
    setPw('')
    setPw2('')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="เปลี่ยนรหัสผ่าน"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button onClick={save} loading={busy}>
            บันทึก
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="รหัสผ่านปัจจุบัน">
          <Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
        </Field>
        <Field label="รหัสผ่านใหม่" hint="อย่างน้อย 10 ตัว มีตัวพิมพ์เล็ก ตัวพิมพ์ใหญ่ และตัวเลข">
          <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <Field label="ยืนยันรหัสผ่านใหม่">
          <Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </Field>
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      </div>
    </Modal>
  )
}

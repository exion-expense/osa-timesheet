import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !key) {
  throw new Error('ยังไม่ได้ตั้งค่า VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (ดู .env.example)')
}
// กันพลาด: ห้ามใช้ service_role key ฝั่งหน้าเว็บ
if (key.startsWith('sb_secret_') || /"role"\s*:\s*"service_role"/.test(safeJwtPayload(key))) {
  throw new Error('ห้ามใช้ service_role / secret key ในหน้าเว็บ')
}

function safeJwtPayload(jwt: string): string {
  try {
    return atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
  } catch {
    return ''
  }
}

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
})

// แปลงข้อความ error จาก Postgres/Supabase ให้อ่านง่าย
export function errMsg(e: unknown): string {
  if (!e) return 'เกิดข้อผิดพลาด'
  const m = typeof e === 'string' ? e : (e as { message?: string }).message ?? String(e)
  if (/Invalid login credentials/i.test(m)) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
  if (/row-level security|permission denied/i.test(m)) return 'ไม่มีสิทธิ์ทำรายการนี้'
  if (/duplicate key/i.test(m)) return 'ข้อมูลนี้มีอยู่แล้ว'
  if (/Failed to fetch|NetworkError/i.test(m)) return 'เชื่อมต่อไม่ได้ กรุณาตรวจอินเทอร์เน็ต'
  return m
}

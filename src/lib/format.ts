const TZ = 'Asia/Bangkok'

const dateTh = new Intl.DateTimeFormat('th-TH', { timeZone: TZ, day: 'numeric', month: 'short', year: '2-digit' })
const dateThLong = new Intl.DateTimeFormat('th-TH', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
const money = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

// วันที่แบบ YYYY-MM-DD (ไม่มีเวลา) ให้ตีความเป็นวันในไทย
const asDate = (d: string | Date) => (typeof d === 'string' && d.length === 10 ? new Date(`${d}T12:00:00+07:00`) : new Date(d))

export const fmtDate = (d?: string | Date | null) => (d ? dateTh.format(asDate(d)) : '-')
export const fmtDateLong = (d?: string | Date | null) => (d ? dateThLong.format(asDate(d)) : '-')
export const fmtTime = (d?: string | Date | null) => (d ? timeFmt.format(new Date(d)) : '-')
export const fmtMoney = (n?: number | string | null) => money.format(Number(n ?? 0))
export const fmtNum = (n?: number | string | null) => num.format(Number(n ?? 0))
export const fmtHours = (n?: number | string | null) => (Number(n ?? 0) === 0 ? '' : num.format(Number(n)))

/** dd/MM/yyyy (ค.ศ.) แบบในเอกสาร */
export const fmtDocDate = (d?: string | Date | null) => {
  if (!d) return ''
  const [y, m, dd] = ymdFmt.format(asDate(d)).split('-')
  return `${dd}/${m}/${y}`
}
export const fmtDateTime = (d?: string | null) => (d ? `${fmtDate(d)} ${fmtTime(d)}` : '-')

/** เวลาออก — ถ้าออกหลังเที่ยงคืน (คนละวันกับเวลาเข้า) ต่อท้าย (+1) */
export const fmtOut = (checkIn: string, checkOut?: string | null) => {
  if (!checkOut) return ''
  const days = Math.round((Date.parse(`${ymdFmt.format(new Date(checkOut))}T12:00:00Z`) - Date.parse(`${ymdFmt.format(new Date(checkIn))}T12:00:00Z`)) / 86400000)
  return days > 0 ? `${fmtTime(checkOut)} (+${days})` : fmtTime(checkOut)
}

export const todayYmd = () => ymdFmt.format(new Date())
export const toYmd = (d: Date) => ymdFmt.format(d)

/** รวมวันที่ (YYYY-MM-DD) กับเวลา (HH:mm) เป็น ISO เวลาไทย */
export const bkkIso = (ymd: string, hm: string) => `${ymd}T${hm}:00+07:00`

export function addDays(ymd: string, n: number) {
  const d = new Date(`${ymd}T12:00:00+07:00`)
  d.setUTCDate(d.getUTCDate() + n)
  return toYmd(d)
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d)
  return out
}

export const dayOfMonth = (ymd: string) => Number(ymd.slice(8, 10))
export const weekdayShort = (ymd: string) =>
  new Intl.DateTimeFormat('th-TH', { timeZone: TZ, weekday: 'narrow' }).format(asDate(ymd))
export const isoDow = (ymd: string) => {
  const d = asDate(ymd).getUTCDay()
  return d === 0 ? 7 : d
}

const ones = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า']
const places = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน']
function readInt(s: string): string {
  if (s.length > 6) return readInt(s.slice(0, -6)) + 'ล้าน' + readInt(s.slice(-6))
  let out = ''
  const n = s.length
  for (let i = 0; i < n; i++) {
    const d = Number(s[i])
    const p = n - i - 1
    if (d === 0) continue
    if (p === 1 && d === 1) out += 'สิบ'
    else if (p === 1 && d === 2) out += 'ยี่สิบ'
    else if (p === 0 && d === 1 && n > 1) out += 'เอ็ด'
    else out += ones[d] + places[p]
  }
  return out
}
/** จำนวนเงินเป็นตัวอักษรไทย เช่น 293903.94 → สองแสนเก้าหมื่นสามพันเก้าร้อยสามบาทเก้าสิบสี่สตางค์ */
export function bahtText(amount: number): string {
  const neg = amount < 0
  const [b, s] = Math.abs(amount).toFixed(2).split('.')
  const baht = BigInt(b) === 0n ? 'ศูนย์' : readInt(b.replace(/^0+/, ''))
  const satang = Number(s) === 0 ? 'ถ้วน' : readInt(String(Number(s))) + 'สตางค์'
  return (neg ? 'ลบ' : '') + baht + 'บาท' + satang
}

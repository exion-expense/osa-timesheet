import { describe, expect, it } from 'vitest'
import { addDays, bahtText, daysBetween, fmtDocDate, fmtOut, isoDow } from './format'

describe('bahtText', () => {
  it('อ่านจำนวนเงินตามเอกสารตัวอย่าง', () => {
    expect(bahtText(293903.94)).toBe('สองแสนเก้าหมื่นสามพันเก้าร้อยสามบาทเก้าสิบสี่สตางค์')
  })
  it('เอ็ด ยี่ ถ้วน', () => {
    expect(bahtText(21)).toBe('ยี่สิบเอ็ดบาทถ้วน')
    expect(bahtText(101.01)).toBe('หนึ่งร้อยเอ็ดบาทหนึ่งสตางค์')
    expect(bahtText(1000000)).toBe('หนึ่งล้านบาทถ้วน')
    expect(bahtText(0)).toBe('ศูนย์บาทถ้วน')
  })
})

describe('วันที่ (เวลาไทย)', () => {
  it('บวกวันข้ามเดือน', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(daysBetween('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'])
  })
  it('วันอาทิตย์ = 7', () => {
    expect(isoDow('2026-10-18')).toBe(7)
    expect(isoDow('2026-10-17')).toBe(6)
  })
  it('รูปแบบวันที่ในเอกสาร', () => {
    expect(fmtDocDate('2026-10-02')).toBe('02/10/2026')
    expect(fmtDocDate('2026-10-01T18:30:00Z')).toBe('02/10/2026')
  })
})

describe('เวลาออกข้ามเที่ยงคืน', () => {
  it('วันเดียวกันไม่มี (+1)', () => {
    expect(fmtOut('2026-10-21T01:00:00Z', '2026-10-21T10:00:00Z')).toBe('17:00')
  })
  it('ออกหลังเที่ยงคืนเวลาไทยมี (+1)', () => {
    // เข้า 08:00 ไทย (01:00Z) ออก 01:00 ไทยของวันถัดไป (18:00Z)
    expect(fmtOut('2026-10-21T01:00:00Z', '2026-10-21T18:00:00Z')).toBe('01:00 (+1)')
  })
})

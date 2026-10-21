/**
 * แปลงรูปถ่าย/สแกนลายเซ็นเป็น PNG พื้นใส: ตัดพื้นหลังสว่างออก ครอปให้พอดี ย่อไม่เกิน 600×200
 * คืนค่าเป็น data URL (เก็บในฐานข้อมูลได้เลย)
 */
export async function processSignature(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('กรุณาเลือกไฟล์รูปภาพ (PNG หรือ JPG)')
  if (file.size > 15 * 1024 * 1024) throw new Error('ไฟล์ใหญ่เกินไป (ไม่เกิน 15MB)')
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(file)
  } catch {
    throw new Error('เปิดรูปนี้ไม่ได้ ลองถ่ายใหม่หรือบันทึกเป็น JPG/PNG')
  }

  // ย่อก่อนประมวลผล
  const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * s)
  const h = Math.round(bmp.height * s)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bmp, 0, 0, w, h)
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data

  // พื้นสว่าง → โปร่งใส, เส้นหมึก → สีน้ำเงินเข้ม
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      const a = Math.max(0, Math.min(255, ((190 - lum) / 110) * 255))
      d[i] = 20
      d[i + 1] = 35
      d[i + 2] = 80
      d[i + 3] = a
      if (a > 40) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) throw new Error('ไม่พบลายเซ็นในรูป ลองเซ็นด้วยปากกาสีเข้มบนกระดาษขาว')
  ctx.putImageData(img, 0, 0)

  const pad = 8
  const cx = Math.max(0, minX - pad)
  const cy = Math.max(0, minY - pad)
  const cw = Math.min(w, maxX + pad) - cx
  const ch = Math.min(h, maxY + pad) - cy

  for (const [mw, mh] of [[600, 200], [450, 150], [300, 100]]) {
    const k = Math.min(1, mw / cw, mh / ch)
    const out = document.createElement('canvas')
    out.width = Math.max(1, Math.round(cw * k))
    out.height = Math.max(1, Math.round(ch * k))
    out.getContext('2d')!.drawImage(c, cx, cy, cw, ch, 0, 0, out.width, out.height)
    const url = out.toDataURL('image/png')
    if (url.length <= 190000) return url
  }
  throw new Error('ลายเซ็นมีรายละเอียดมากเกินไป ลองครอปให้เหลือเฉพาะลายเซ็น')
}

import { useEffect, useRef, useState, type ReactNode } from 'react'

const MM = 96 / 25.4

/** แสดงเอกสาร A4 ในหน้า ย่อให้พอดีความกว้าง (ไม่ย่อเกินขนาดจริง) */
export function DocPreview({ children, landscape }: { children: ReactNode; landscape?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const paperPx = (landscape ? 297 : 210) * MM + 8
    const ro = new ResizeObserver(() => setZoom(Math.min(1, (el.clientWidth - 24) / paperPx)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [landscape])
  return (
    <div ref={ref} className="overflow-hidden rounded-xl bg-slate-200 px-3">
      <div style={{ zoom }}>{children}</div>
    </div>
  )
}

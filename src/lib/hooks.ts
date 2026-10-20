import { useCallback, useEffect, useRef, useState } from 'react'
import { errMsg } from './supabase'

/** โหลดข้อมูลแบบง่าย: { data, error, loading, reload } */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)

  const reload = useCallback(async () => {
    const my = ++seq.current
    setLoading(true)
    try {
      const v = await fn()
      if (my === seq.current) {
        setData(v)
        setError(null)
      }
    } catch (e) {
      if (my === seq.current) setError(errMsg(e))
    } finally {
      if (my === seq.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    reload()
  }, [reload])

  return { data, error, loading, reload, setData }
}

/** โยน error ของ supabase ออกมาเป็น exception */
export function must<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error
  return res.data as T
}

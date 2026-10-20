import { BadgeCheck, CircleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { fmtDateTime } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Job } from '../lib/types'
import { Button } from './ui'

/** แสดงว่าเงื่อนไขคิดราคาของจ็อบ (5/6 วัน, พักเย็น) ถูกยืนยันโดยใคร หรือยังเป็นค่าเริ่มต้น */
export function TermsStatus({ job, canEdit, onConfirm }: { job: Pick<Job, 'terms_confirmed_by' | 'terms_confirmed_at'>; canEdit: boolean; onConfirm: () => void }) {
  const [name, setName] = useState('')
  useEffect(() => {
    if (!job.terms_confirmed_by) return
    supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', job.terms_confirmed_by)
      .maybeSingle()
      .then(({ data }) => setName(data?.full_name || data?.email || ''))
  }, [job.terms_confirmed_by])

  if (job.terms_confirmed_at)
    return (
      <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <BadgeCheck className="size-4 shrink-0" />
        ยืนยันโดย {name || '…'} · {fmtDateTime(job.terms_confirmed_at)}
      </p>
    )
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <span className="flex items-center gap-2">
        <CircleAlert className="size-4 shrink-0" />
        เป็นค่าเริ่มต้นของระบบ — {canEdit ? 'ตรวจแล้วกดยืนยัน (หรือกดเลือกตัวเลือก)' : 'รอ Purchase ยืนยัน'} ก่อนส่งใบคิดราคา
      </span>
      {canEdit && (
        <Button size="sm" onClick={onConfirm}>
          ยืนยันเงื่อนไขนี้
        </Button>
      )}
    </div>
  )
}

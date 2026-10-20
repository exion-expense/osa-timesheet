import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { ErrorBox, Spinner } from '../components/ui'
import { fmtDocDate } from '../lib/format'
import { must, useLoad } from '../lib/hooks'
import { supabase } from '../lib/supabase'
import type { Job, Team } from '../lib/types'
import { kioskUrl } from '../pages/TeamPage'
import { Paper, PrintShell } from './common'

export default function PrintQr() {
  const { id = '' } = useParams()
  const [qr, setQr] = useState('')
  const { data, error } = useLoad(async () => {
    const team = must(await supabase.from('teams').select('*').eq('id', id).single()) as Team
    const job = must(await supabase.from('jobs').select('*').eq('id', team.job_id).single()) as Job
    return { team, job }
  }, [id])
  useEffect(() => {
    if (data) QRCode.toDataURL(kioskUrl(data.team.qr_token), { width: 900, margin: 1, errorCorrectionLevel: 'M' }).then(setQr)
  }, [data])

  if (error) return <ErrorBox message={error} />
  if (!data) return <Spinner />
  const { team, job } = data

  return (
    <PrintShell title={`QR ${job.job_no} ${team.name}`}>
      <Paper className="mx-auto flex flex-col items-center text-center">
        <img src={`${import.meta.env.BASE_URL}brand/osa-logo.png`} alt="OSA" style={{ height: '22mm' }} className="mt-6" />
        <h1 className="mt-8 text-4xl font-bold">สแกนเพื่อลงเวลา</h1>
        <p className="mt-2 text-xl">เข้างาน / ออกงาน</p>
        <div className="mt-8 rounded-3xl border-4 border-black p-4">{qr && <img src={qr} alt="QR" style={{ width: '110mm', height: '110mm' }} />}</div>
        <p className="mt-6 text-3xl font-bold">{job.job_no}</p>
        <p className="text-xl">
          {job.title} · {team.name}
        </p>
        <ol className="mt-10 grid w-full grid-cols-3 gap-4 text-left text-base">
          {['สแกน QR ด้วยกล้องมือถือ', 'เลือกชื่อตัวเอง แล้วใส่ PIN 4 หลักที่ได้จากหัวหน้างานวันนี้', 'กด “เช็คอิน” ตอนเข้างาน และ “เช็คเอาท์” ตอนเลิกงาน'].map((t, i) => (
            <li key={i} className="rounded-2xl border-2 border-slate-300 p-4">
              <span className="mb-2 flex size-9 items-center justify-center rounded-full bg-black text-lg font-bold text-white">{i + 1}</span>
              {t}
            </li>
          ))}
        </ol>
        <p className="mt-auto pt-8 text-sm text-slate-600">
          ใช้ได้ {fmtDocDate(job.start_date)} – {fmtDocDate(job.end_date)} · ห้ามลงเวลาแทนผู้อื่น
        </p>
      </Paper>
    </PrintShell>
  )
}

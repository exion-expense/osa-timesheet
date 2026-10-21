import { CalendarClock, CheckCircle2, Circle, CircleDot, ClipboardCheck, Copy, Download, Eye, EyeOff, Link2, Lock, Play, Printer, RefreshCw, Share2, Users } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Badge, Button, Card, CardHeader, cx, Empty, ErrorBox, PageHeader, Spinner, useToast } from '../components/ui'
import { useAuth } from '../lib/auth'
import { fmtDate, fmtDateLong, fmtTime, todayYmd } from '../lib/format'
import { must, useLoad } from '../lib/hooks'
import { downloadBlob, makeQrArtwork } from '../lib/qrArt'
import { supabase } from '../lib/supabase'
import type { DaySheet } from '../lib/types'
import { kioskUrl } from './TeamPage'

type TeamRow = {
  id: string
  name: string
  supervisor_id: string | null
  qr_token: string
  job_id: string
  jobs: { id: string; job_no: string; title: string; status: string; start_date: string; end_date: string }
  workers: { id: string; active: boolean }[]
}
type Sheet = DaySheet & { opened_at: string | null; opened_by: string | null }

type Stage = 'closed' | 'open' | 'complete' | 'approved'
function stageOf(s?: Sheet): Stage {
  if (!s?.opened_at) return 'closed'
  if (s.supervisor_approved_at) return 'approved'
  if (s.people > 0 && s.open_people === 0) return 'complete'
  return 'open'
}
const STAGE: Record<Stage, { label: string; icon: typeof Circle; cls: string }> = {
  closed: { label: 'ยังไม่เปิด', icon: Circle, cls: 'text-slate-400' },
  open: { label: 'เปิดลงเวลาแล้ว', icon: CircleDot, cls: 'text-emerald-600' },
  complete: { label: 'ลงเวลาครบ รออนุมัติ', icon: ClipboardCheck, cls: 'text-amber-600' },
  approved: { label: 'อนุมัติแล้ว', icon: CheckCircle2, cls: 'text-brand-600' },
}

/** ลงเวลาวันนี้: ซ้ายเป็นทีมที่ต้องเปิดวันนี้ ขวาเป็นหน้าทำงานของทีมที่เลือก */
export default function Today() {
  const { profile, is } = useAuth()
  const [params, setParams] = useSearchParams()
  const today = todayYmd()

  const { data, error, loading, reload } = useLoad(async () => {
    const [teams, sheets] = await Promise.all([
      supabase.from('teams').select('id, name, supervisor_id, qr_token, job_id, jobs(id, job_no, title, status, start_date, end_date), workers(id, active)'),
      supabase.from('v_day_sheets').select('*').eq('work_date', today),
    ])
    const all = must(teams) as unknown as TeamRow[]
    const mine = all
      .filter((t) => t.jobs.status === 'active' && today >= t.jobs.start_date && today <= t.jobs.end_date)
      .filter((t) => is('admin') || t.supervisor_id === profile?.id)
      .sort((a, b) => a.jobs.job_no.localeCompare(b.jobs.job_no) || a.name.localeCompare(b.name))
    return { teams: mine, sheets: must(sheets) as Sheet[] }
  }, [today, profile?.id])

  // อัปเดตสถานะทุก 30 วินาที (ดูคนเข้า-ออกแบบสด)
  useEffect(() => {
    const t = setInterval(reload, 30000)
    return () => clearInterval(t)
  }, [reload])

  if (loading && !data) return <Spinner />
  if (error || !data) return <ErrorBox message={error ?? ''} onRetry={reload} />
  const { teams, sheets } = data
  const sheetOf = (teamId: string) => sheets.find((s) => s.team_id === teamId)
  const selectedId = params.get('team') ?? teams[0]?.id
  const selected = teams.find((t) => t.id === selectedId) ?? teams[0]

  return (
    <>
      <PageHeader title="ลงเวลาวันนี้" sub={fmtDateLong(today)} />
      {teams.length === 0 ? (
        <Card>
          <Empty icon={<CalendarClock className="size-6" />} title="วันนี้ไม่มีทีมที่ต้องเปิดลงเวลา" sub="จะแสดงเฉพาะทีมที่คุณคุม ในจ็อบที่เปิดอยู่และวันนี้อยู่ในช่วงวันที่ของจ็อบ" />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <Card className="h-fit overflow-hidden">
            <ul className="divide-y divide-slate-100">
              {teams.map((t) => {
                const st = stageOf(sheetOf(t.id))
                const S = STAGE[st]
                const active = t.id === selected?.id
                return (
                  <li key={t.id}>
                    <button
                      onClick={() => setParams({ team: t.id }, { replace: true })}
                      className={cx('flex w-full items-start gap-3 px-4 py-3.5 text-left transition', active ? 'bg-brand-50' : 'hover:bg-slate-50')}
                    >
                      <S.icon className={cx('mt-0.5 size-5 shrink-0', S.cls)} />
                      <div className="min-w-0">
                        <p className={cx('truncate font-medium', active ? 'text-brand-800' : 'text-slate-900')}>
                          <span className="font-mono">{t.jobs.job_no}</span> · {t.name}
                        </p>
                        <p className="truncate text-xs text-slate-500">{t.jobs.title}</p>
                        <p className={cx('mt-0.5 text-xs font-medium', S.cls)}>
                          {S.label}
                          {st === 'open' && sheetOf(t.id)?.opened_at && ` ${fmtTime(sheetOf(t.id)!.opened_at)}`}
                        </p>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </Card>
          {selected && <Workspace key={selected.id} team={selected} sheet={sheetOf(selected.id)} onChanged={reload} />}
        </div>
      )}
    </>
  )
}

type Pin = { worker_id: string; pin: string; failed_attempts: number }
type Att = { worker_id: string; check_in: string; check_out: string | null }
type W = { id: string; full_name: string; position: string }

function Workspace({ team, sheet, onChanged }: { team: TeamRow; sheet?: Sheet; onChanged: () => void }) {
  const toast = useToast()
  const today = todayYmd()
  const [busy, setBusy] = useState(false)
  const [showPins, setShowPins] = useState(false)
  const stage = stageOf(sheet)

  const { data, reload } = useLoad(async () => {
    const [workers, pins, att, settings] = await Promise.all([
      supabase.from('workers').select('id, full_name, position').eq('team_id', team.id).eq('active', true).order('full_name'),
      supabase.from('daily_pins').select('worker_id, pin, failed_attempts').eq('work_date', today),
      supabase.from('attendance').select('worker_id, check_in, check_out').eq('team_id', team.id).eq('work_date', today),
      supabase.from('app_settings').select('pin_max_attempts').eq('id', 1).maybeSingle(),
    ])
    return {
      workers: must(workers) as W[],
      pins: must(pins) as Pin[],
      att: must(att) as Att[],
      max: (must(settings) as { pin_max_attempts: number } | null)?.pin_max_attempts ?? 5,
    }
  }, [team.id, today, sheet?.people, sheet?.open_people, sheet?.opened_at])

  async function openDay() {
    setBusy(true)
    const { error } = await supabase.rpc('open_day', { p_team: team.id })
    setBusy(false)
    if (error) return toast.err(error)
    toast.ok('เปิดลงเวลาแล้ว และสร้าง PIN ให้ทุกคน')
    setShowPins(true)
    onChanged()
  }

  async function regen(workerId: string) {
    const { error } = await supabase.rpc('generate_pins', { p_team: team.id, p_worker: workerId })
    if (error) return toast.err(error)
    toast.ok('สุ่ม PIN ใหม่และปลดล็อกแล้ว')
    setShowPins(true)
    reload()
  }

  const came = data?.att.length ?? 0
  const out = data?.att.filter((a) => a.check_out).length ?? 0
  const total = data?.workers.length ?? team.workers.filter((w) => w.active).length

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div>
            <p className="text-sm text-slate-500">
              <Link to={`/jobs/${team.job_id}`} className="font-mono text-brand-700 hover:underline">
                {team.jobs.job_no}
              </Link>{' '}
              · {team.jobs.title}
            </p>
            <h2 className="mt-0.5 text-xl font-semibold text-slate-900">{team.name}</h2>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
              <Users className="size-4" /> {total} คนในทีม ·{' '}
              <Link to={`/teams/${team.id}`} className="text-brand-600 hover:underline">
                จัดการรายชื่อ
              </Link>
            </p>
          </div>
          {stage !== 'closed' && (
            <div className="flex flex-wrap gap-2">
              <Badge tone="green">เข้าแล้ว {came}/{total}</Badge>
              <Badge tone={came > 0 && out === came ? 'blue' : 'gray'}>
                ออกแล้ว {out}/{came}
              </Badge>
            </div>
          )}
        </div>

        {stage === 'closed' ? (
          <div className="border-t border-slate-100 p-8 text-center">
            <p className="text-slate-600">ยังไม่เปิดลงเวลาของวันนี้ ผู้รับเหมาจะสแกน QR ไม่ได้จนกว่าจะเปิด</p>
            <Button size="lg" className="mt-5" loading={busy} onClick={openDay}>
              <Play className="size-5" /> เปิดลงเวลาวันนี้
            </Button>
            <p className="mt-3 text-xs text-slate-500">ระบบจะสุ่ม PIN ของวันนี้ให้ทุกคนในทีมพร้อมกัน</p>
          </div>
        ) : (
          <div
            className={cx(
              'flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 text-sm',
              stage === 'complete' ? 'border-amber-100 bg-amber-50 text-amber-800' : stage === 'approved' ? 'border-brand-100 bg-brand-50 text-brand-800' : 'border-emerald-100 bg-emerald-50 text-emerald-800',
            )}
          >
            <span>
              {stage === 'open' && `เปิดลงเวลาแล้วเมื่อ ${fmtTime(sheet!.opened_at)} · ${came > out ? `ยังอยู่หน้างาน ${came - out} คน` : 'รอผู้รับเหมาสแกน'}`}
              {stage === 'complete' && 'ทุกคนที่มาวันนี้ลงเวลาออกครบแล้ว — ตรวจและอนุมัติได้เลย'}
              {stage === 'approved' && 'หัวหน้างานอนุมัติแล้ว — รอ Planner'}
            </span>
            {sheet && (
              <Link to={`/days/${sheet.id}`}>
                <Button size="sm" variant={stage === 'complete' ? 'success' : 'secondary'}>
                  <ClipboardCheck className="size-4" /> {stage === 'complete' ? 'ตรวจและอนุมัติ' : 'ดูใบลงเวลา'}
                </Button>
              </Link>
            )}
          </div>
        )}
      </Card>

      {stage !== 'closed' && (
        <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
          <Card>
            <CardHeader
              title="PIN และเวลาวันนี้"
              sub="บอก PIN เป็นรายคน อย่าส่งในกลุ่มแชท"
              right={
                <Button variant="ghost" size="sm" onClick={() => setShowPins(!showPins)}>
                  {showPins ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  {showPins ? 'ซ่อน PIN' : 'แสดง PIN'}
                </Button>
              }
            />
            {!data ? (
              <Spinner />
            ) : data.workers.length === 0 ? (
              <Empty title="ยังไม่มีลูกทีม" action={<Link to={`/teams/${team.id}`}><Button size="sm" variant="secondary">เพิ่มรายชื่อ</Button></Link>} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-5 py-2.5">ชื่อ</th>
                      <th className="px-3 py-2.5 text-center">PIN</th>
                      <th className="px-3 py-2.5 text-center">เข้า</th>
                      <th className="px-3 py-2.5 text-center">ออก</th>
                      <th className="px-5 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.workers.map((w) => {
                      const p = data.pins.find((x) => x.worker_id === w.id)
                      const a = data.att.find((x) => x.worker_id === w.id)
                      const locked = p && p.failed_attempts >= data.max
                      return (
                        <tr key={w.id}>
                          <td className="px-5 py-3">
                            <p className="font-medium text-slate-900">{w.full_name}</p>
                            <p className="text-xs text-slate-500">{w.position}</p>
                          </td>
                          <td className="px-3 py-3 text-center">
                            {p ? (
                              <span className="inline-flex items-center gap-1">
                                <span className="tabular rounded-lg bg-slate-100 px-2.5 py-1 font-mono text-base font-semibold tracking-widest">{showPins ? p.pin : '••••'}</span>
                                {locked && (
                                  <Badge tone="red">
                                    <Lock className="size-3" /> ล็อก
                                  </Badge>
                                )}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">ยังไม่มี</span>
                            )}
                          </td>
                          <td className="tabular px-3 py-3 text-center">{a ? fmtTime(a.check_in) : '–'}</td>
                          <td className="tabular px-3 py-3 text-center">{a?.check_out ? fmtTime(a.check_out) : a ? <Badge tone="green">อยู่</Badge> : '–'}</td>
                          <td className="px-5 py-3 text-right">
                            <button onClick={() => regen(w.id)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="สุ่ม PIN ใหม่ / ปลดล็อก" aria-label={`สุ่ม PIN ใหม่ ${w.full_name}`}>
                              <RefreshCw className="size-4" />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <QrCard team={team} />
        </div>
      )}
    </div>
  )
}

function QrCard({ team }: { team: TeamRow }) {
  const toast = useToast()
  const [qr, setQr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const url = kioskUrl(team.qr_token)
  const info = {
    url,
    jobNo: team.jobs.job_no,
    jobTitle: team.jobs.title,
    team: team.name,
    validText: `ใช้ได้ ${fmtDate(team.jobs.start_date)} – ${fmtDate(team.jobs.end_date)}`,
    company: 'OSA Valve Services (Thailand) Co., Ltd.',
  }
  const fileName = `QR-ลงเวลา-${team.jobs.job_no}-${team.name}.png`

  useEffect(() => {
    QRCode.toDataURL(url, { width: 480, margin: 1, errorCorrectionLevel: 'M' }).then(setQr)
  }, [url])

  async function copyImage() {
    setBusy('copy')
    try {
      const blob = makeQrArtwork(info)
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      toast.ok('คัดลอกรูปแล้ว วางในไลน์ได้เลย')
    } catch {
      downloadBlob(await makeQrArtwork(info), fileName)
      toast.ok('เบราว์เซอร์นี้คัดลอกรูปไม่ได้ จึงบันทึกเป็นไฟล์ให้แทน')
    } finally {
      setBusy(null)
    }
  }

  async function shareImage() {
    setBusy('share')
    try {
      const file = new File([await makeQrArtwork(info)], fileName, { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `ลงเวลา ${team.jobs.job_no} ${team.name}` })
      } else {
        downloadBlob(file, fileName)
        toast.ok('บันทึกรูปแล้ว ส่งต่อในไลน์ได้เลย')
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast.err(e)
    } finally {
      setBusy(null)
    }
  }

  async function saveImage() {
    setBusy('save')
    try {
      downloadBlob(await makeQrArtwork(info), fileName)
    } catch (e) {
      toast.err(e)
    } finally {
      setBusy(null)
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(url)
    toast.ok('คัดลอกลิงก์แล้ว')
  }

  return (
    <Card className="h-fit">
      <CardHeader title="QR สำหรับลงเวลา" sub="ส่งให้ผู้รับเหมา หรือพิมพ์ติดหน้างาน" />
      <div className="p-5">
        {qr ? <img src={qr} alt="QR ลงเวลา" className="mx-auto w-full max-w-56 rounded-xl border border-slate-200" /> : <Spinner />}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button size="sm" onClick={copyImage} loading={busy === 'copy'}>
            <Copy className="size-4" /> คัดลอกรูป
          </Button>
          <Button size="sm" variant="secondary" onClick={shareImage} loading={busy === 'share'}>
            <Share2 className="size-4" /> แชร์รูป
          </Button>
          <Button size="sm" variant="secondary" onClick={saveImage} loading={busy === 'save'}>
            <Download className="size-4" /> บันทึกรูป
          </Button>
          <Link to={`/print/qr/${team.id}`} target="_blank" className="block">
            <Button size="sm" variant="secondary" className="w-full">
              <Printer className="size-4" /> พิมพ์ป้าย
            </Button>
          </Link>
        </div>
        <button onClick={copyLink} className="mt-3 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
          <Link2 className="size-3.5" /> คัดลอกเป็นลิงก์แทน
        </button>
      </div>
    </Card>
  )
}

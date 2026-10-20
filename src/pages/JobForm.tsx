import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Forbidden } from '../components/Guards'
import { Button, Card, CardHeader, Field, Input, PageHeader, Select, Spinner, Textarea, useToast } from '../components/ui'
import { useAuth } from '../lib/auth'
import { addDays, todayYmd } from '../lib/format'
import { must, useLoad } from '../lib/hooks'
import { supabase } from '../lib/supabase'
import type { Job, Profile, Team } from '../lib/types'

interface TeamDraft {
  id?: string
  name: string
  supervisor_id: string
  members: string
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** แปลงข้อความหลายบรรทัดเป็นรายชื่อ: "ชื่อ นามสกุล" หรือ "ชื่อ นามสกุล, ตำแหน่ง" */
function parseMembers(text: string) {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter((l) => l.length >= 2)
    .map((l) => {
      const [full_name, position] = l.split(/\s*[,|\t]\s*/)
      return { full_name: full_name.trim(), position: (position ?? '').trim() }
    })
}

export default function JobForm() {
  const { id } = useParams()
  const editing = Boolean(id)
  const { is } = useAuth()
  const nav = useNavigate()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [job, setJob] = useState({ job_no: '', title: '', contractor_name: '', location: '', start_date: todayYmd(), end_date: addDays(todayYmd(), 10) })
  const [teams, setTeams] = useState<TeamDraft[]>([{ name: 'ทีม A', supervisor_id: '', members: '' }])

  const sup = useLoad(
    async () => must(await supabase.from('profiles').select('*').eq('role', 'supervisor').eq('active', true).order('full_name')) as Profile[],
    [],
  )
  const existing = useLoad(async () => {
    if (!id) return null
    const j = must(await supabase.from('jobs').select('*').eq('id', id).single()) as Job
    const t = must(await supabase.from('teams').select('*').eq('job_id', id).order('name')) as Team[]
    return { j, t }
  }, [id])

  useEffect(() => {
    if (!existing.data) return
    const { j, t } = existing.data
    setJob({ job_no: j.job_no, title: j.title, contractor_name: j.contractor_name ?? '', location: j.location ?? '', start_date: j.start_date, end_date: j.end_date })
    setTeams(t.map((x) => ({ id: x.id, name: x.name, supervisor_id: x.supervisor_id ?? '', members: '' })))
  }, [existing.data])

  if (!is('admin')) return <Forbidden />
  if (editing && existing.loading) return <Spinner />

  const set = (k: keyof typeof job) => (e: { target: { value: string } }) => setJob({ ...job, [k]: e.target.value })
  const setTeam = (i: number, patch: Partial<TeamDraft>) => setTeams(teams.map((t, j) => (j === i ? { ...t, ...patch } : t)))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (job.end_date < job.start_date) return toast.err('วันสิ้นสุดต้องไม่ก่อนวันเริ่ม')
    const names = teams.map((t) => t.name.trim())
    if (new Set(names).size !== names.length) return toast.err('ชื่อทีมซ้ำกัน')
    setBusy(true)
    try {
      if (!editing) {
        const newId = must(
          await supabase.rpc('create_job', {
            p: { ...job, teams: teams.map((t) => ({ name: t.name, supervisor_id: t.supervisor_id, members: parseMembers(t.members) })) },
          }),
        ) as string
        toast.ok('สร้างจ็อบแล้ว')
        nav(`/jobs/${newId}`, { replace: true })
      } else {
        must(
          await supabase
            .from('jobs')
            .update({ ...job, contractor_name: job.contractor_name || null, location: job.location || null })
            .eq('id', id!),
        )
        for (const t of teams) {
          if (t.id) {
            must(await supabase.from('teams').update({ name: t.name.trim(), supervisor_id: t.supervisor_id || null }).eq('id', t.id))
          } else {
            const nt = must(
              await supabase.from('teams').insert({ job_id: id, name: t.name.trim(), supervisor_id: t.supervisor_id || null }).select('id').single(),
            ) as { id: string }
            const members = parseMembers(t.members)
            if (members.length)
              must(await supabase.from('workers').insert(members.map((m) => ({ ...m, position: m.position || 'T/C', job_id: id, team_id: nt.id }))))
          }
        }
        toast.ok('บันทึกแล้ว')
        nav(`/jobs/${id}`, { replace: true })
      }
    } catch (err) {
      toast.err(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <PageHeader
        back={
          <Link to={editing ? `/jobs/${id}` : '/jobs'} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft className="size-4" /> กลับ
          </Link>
        }
        title={editing ? 'แก้ไขจ็อบ' : 'เพิ่มจ็อบใหม่'}
        sub="ใส่เลขจ็อบ ช่วงวันที่ และกำหนดหัวหน้างานกับลูกทีมของแต่ละทีม"
        right={
          <Button type="submit" loading={busy}>
            บันทึก
          </Button>
        }
      />

      <Card className="mb-6">
        <CardHeader title="ข้อมูลจ็อบ" />
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="เลขจ็อบ *">
            <Input required maxLength={40} placeholder="VT260020" value={job.job_no} onChange={set('job_no')} />
          </Field>
          <Field label="ลูกค้า / หน้างาน *">
            <Input required maxLength={200} placeholder="PTT GSP6" value={job.title} onChange={set('title')} />
          </Field>
          <Field label="ชุดผู้รับเหมา (ผู้รับเงิน)">
            <Input maxLength={200} placeholder="ชุดนายสมชาย" value={job.contractor_name} onChange={set('contractor_name')} />
          </Field>
          <Field label="สถานที่">
            <Input maxLength={200} placeholder="มาบตาพุด ระยอง" value={job.location} onChange={set('location')} />
          </Field>
          <Field label="วันเริ่ม *">
            <Input type="date" required value={job.start_date} onChange={set('start_date')} />
          </Field>
          <Field label="วันสิ้นสุด *" hint="ผู้รับเหมาลงเวลาได้เฉพาะในช่วงนี้">
            <Input type="date" required value={job.end_date} onChange={set('end_date')} />
          </Field>
        </div>
      </Card>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">ทีม</h2>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setTeams([...teams, { name: `ทีม ${LETTERS[teams.length] ?? teams.length + 1}`, supervisor_id: '', members: '' }])}
        >
          <Plus className="size-4" /> เพิ่มทีม
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {teams.map((t, i) => (
          <Card key={t.id ?? i} className="p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="ชื่อทีม *">
                <Input required maxLength={60} value={t.name} onChange={(e) => setTeam(i, { name: e.target.value })} />
              </Field>
              <Field label="หัวหน้างาน" hint={sup.data?.length === 0 ? 'ยังไม่มีผู้ใช้ตำแหน่งหัวหน้างาน' : undefined}>
                <Select value={t.supervisor_id} onChange={(e) => setTeam(i, { supervisor_id: e.target.value })}>
                  <option value="">— เลือก —</option>
                  {sup.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name || p.email}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {t.id ? (
              <p className="mt-4 text-sm text-slate-500">ลูกทีมของทีมนี้ หัวหน้างานจัดการได้เองที่หน้าทีม</p>
            ) : (
              <Field
                className="mt-4"
                label={`รายชื่อลูกทีม (${parseMembers(t.members).length} คน)`}
                hint="บรรทัดละ 1 คน ใส่ตำแหน่งหลังเครื่องหมายจุลภาคได้ เช่น “สมชาย ใจดี, Foreman” (ไม่ใส่ = T/C) วางจาก Excel ได้"
              >
                <Textarea rows={7} value={t.members} onChange={(e) => setTeam(i, { members: e.target.value })} placeholder={'สมชาย ใจดี\nสมศักดิ์ รักงาน, Foreman'} />
              </Field>
            )}
            {!t.id && teams.length > 1 && (
              <button type="button" onClick={() => setTeams(teams.filter((_, j) => j !== i))} className="mt-3 inline-flex items-center gap-1 text-sm text-rose-600 hover:underline">
                <Trash2 className="size-4" /> ลบทีมนี้
              </button>
            )}
          </Card>
        ))}
      </div>
    </form>
  )
}

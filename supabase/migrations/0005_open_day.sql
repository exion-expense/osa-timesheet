-- =====================================================================
-- 0005: หัวหน้างานกด "เปิดลงเวลาวันนี้" ก่อน ผู้รับเหมาถึงจะลงเวลาได้
-- รันใน Supabase SQL Editor ต่อจาก 0004 (รันซ้ำได้)
-- =====================================================================

alter table public.day_sheets add column if not exists opened_by uuid references public.profiles(id);
alter table public.day_sheets add column if not exists opened_at timestamptz;

-- ใบที่มีอยู่แล้ว (สร้างจากการลงเวลาก่อนมีระบบนี้) ถือว่าเปิดแล้ว
update public.day_sheets set opened_at = created_at where opened_at is null;

-- ---------- เปิดลงเวลาวันนี้: สร้างใบรายวัน + สุ่ม PIN ทุกคน ----------
create or replace function public.open_day(p_team uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t record; v_today date := public.bkk_today(); n int; s public.day_sheets;
begin
  select tm.id, tm.job_id, tm.supervisor_id, j.status, j.start_date, j.end_date into t
  from public.teams tm join public.jobs j on j.id = tm.job_id where tm.id = p_team;
  if not found then raise exception 'ไม่พบทีม'; end if;
  if not (public.has_role('admin') or (public.has_role('supervisor') and t.supervisor_id = auth.uid())) then
    raise exception 'เฉพาะหัวหน้างานของทีมนี้';
  end if;
  if t.status <> 'active' then raise exception 'จ็อบนี้ปิดแล้ว'; end if;
  if v_today not between t.start_date and t.end_date then
    raise exception 'วันนี้ไม่อยู่ในช่วงวันที่ของจ็อบ (แอดมินแก้ช่วงวันที่ได้ที่หน้าจ็อบ)';
  end if;

  insert into public.day_sheets (job_id, team_id, work_date, opened_by, opened_at)
  values (t.job_id, p_team, v_today, auth.uid(), now())
  on conflict (team_id, work_date) do update
    set opened_by = coalesce(public.day_sheets.opened_by, excluded.opened_by),
        opened_at = coalesce(public.day_sheets.opened_at, excluded.opened_at)
  returning * into s;

  n := public.generate_pins(p_team);
  return jsonb_build_object('sheet_id', s.id, 'opened_at', s.opened_at, 'pins_created', n);
end;
$$;

-- ใบที่เกิดจากการลงเวลาย้อนหลังโดยหัวหน้างาน ให้นับว่าเปิดแล้วด้วย
create or replace function public.ensure_day_sheet() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.day_sheets (job_id, team_id, work_date, opened_by, opened_at)
  values (new.job_id, new.team_id, new.work_date, auth.uid(), now())
  on conflict (team_id, work_date) do nothing;
  return null;
end;
$$;

-- ---------- หน้าลงเวลาผู้รับเหมา: ต้องเปิดวันนี้แล้ว ----------
create or replace function public.day_is_open(p_team uuid, p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.day_sheets d where d.team_id = p_team and d.work_date = p_date and d.opened_at is not null);
$$;

create or replace function public.kiosk_team(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t record; v_today date := public.bkk_today();
begin
  select tm.id, tm.name, j.job_no, j.title, j.status, j.start_date, j.end_date into t
  from public.teams tm join public.jobs j on j.id = tm.job_id
  where tm.qr_token = p_token and char_length(p_token) = 48;
  if not found then return jsonb_build_object('ok', false, 'error', 'QR ไม่ถูกต้อง'); end if;
  if t.status <> 'active' or v_today not between t.start_date and t.end_date then
    return jsonb_build_object('ok', false, 'error', 'จ็อบนี้ไม่ได้เปิดลงเวลาในวันนี้');
  end if;
  if not public.day_is_open(t.id, v_today) then
    return jsonb_build_object('ok', false, 'error', 'หัวหน้างานยังไม่เปิดลงเวลาวันนี้ กรุณาแจ้งหัวหน้างาน');
  end if;
  return jsonb_build_object('ok', true, 'job_no', t.job_no, 'job_title', t.title, 'team', t.name,
    'today', v_today,
    'workers', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.full_name) order by w.full_name)
                         from public.workers w where w.team_id = t.id and w.active), '[]'::jsonb));
end;
$$;

create or replace function public.kiosk_check_pin(p_token text, p_worker uuid, p_pin text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_today date := public.bkk_today(); v_max int; p record; w record;
begin
  select x.id, x.full_name, x.team_id, x.job_id into w
  from public.workers x join public.teams tm on tm.id = x.team_id join public.jobs j on j.id = x.job_id
  where x.id = p_worker and x.active and tm.qr_token = p_token and char_length(p_token) = 48
    and j.status = 'active' and v_today between j.start_date and j.end_date;
  if not found then return jsonb_build_object('ok', false, 'error', 'ไม่พบชื่อในทีมนี้'); end if;
  if not public.day_is_open(w.team_id, v_today) then
    return jsonb_build_object('ok', false, 'error', 'หัวหน้างานยังไม่เปิดลงเวลาวันนี้ กรุณาแจ้งหัวหน้างาน');
  end if;

  select s.pin_max_attempts into v_max from public.app_settings s where s.id = 1;
  select * into p from public.daily_pins d where d.worker_id = p_worker and d.work_date = v_today for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'หัวหน้างานยังไม่ได้สร้างรหัสของวันนี้'); end if;
  if p.failed_attempts >= v_max then
    return jsonb_build_object('ok', false, 'locked', true, 'error', 'กรอกรหัสผิดเกินกำหนด กรุณาติดต่อหัวหน้างาน');
  end if;
  if p_pin is null or p.pin <> p_pin then
    update public.daily_pins set failed_attempts = failed_attempts + 1
      where worker_id = p_worker and work_date = v_today;
    return jsonb_build_object('ok', false, 'error', 'รหัสไม่ถูกต้อง',
                              'remaining', greatest(v_max - p.failed_attempts - 1, 0));
  end if;
  return jsonb_build_object('ok', true, 'worker_id', w.id, 'name', w.full_name, 'team_id', w.team_id,
                            'job_id', w.job_id, 'today', v_today);
end;
$$;

-- ---------- view ใบรายวัน: เพิ่มข้อมูลการเปิด ----------
drop view if exists public.v_day_sheets;
create view public.v_day_sheets with (security_invoker = true) as
select d.*,
       t.name as team_name, t.supervisor_id,
       j.job_no, j.title as job_title,
       (d.supervisor_approved_at is not null and d.planner_approved_at is not null) as locked,
       (select count(*) from public.attendance a where a.team_id = d.team_id and a.work_date = d.work_date) as people,
       (select count(*) from public.attendance a where a.team_id = d.team_id and a.work_date = d.work_date and a.check_out is null) as open_people
from public.day_sheets d
join public.teams t on t.id = d.team_id
join public.jobs j on j.id = d.job_id;

-- ---------- สิทธิ์ ----------
revoke all on public.v_day_sheets from anon;
grant select on public.v_day_sheets to authenticated;
revoke execute on function public.open_day(uuid), public.day_is_open(uuid, date), public.ensure_day_sheet(),
  public.kiosk_team(text), public.kiosk_check_pin(text, uuid, text) from public;
revoke execute on function public.open_day(uuid), public.day_is_open(uuid, date), public.ensure_day_sheet(),
  public.kiosk_check_pin(text, uuid, text) from anon;
revoke execute on function public.day_is_open(uuid, date), public.ensure_day_sheet(), public.kiosk_check_pin(text, uuid, text)
  from authenticated;
grant execute on function public.open_day(uuid) to authenticated;
grant execute on function public.kiosk_team(text) to anon, authenticated;

notify pgrst, 'reload schema';

-- =====================================================================
-- 0006: ทำงานข้ามเที่ยงคืน (สแกนออกหลังเที่ยงคืนได้) + ชื่อจริงและลายเซ็นของพนักงาน
-- รันใน Supabase SQL Editor ต่อจาก 0005 (รันซ้ำได้)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) ข้ามเที่ยงคืน: ถ้าเมื่อวานเข้างานแล้วยังไม่ออก (ภายใน 20 ชม.) ให้สแกนออกด้วย PIN ของเมื่อวานได้
--    ชั่วโมงทั้งหมดนับเป็นของวันที่เริ่มงาน
-- ---------------------------------------------------------------------

-- วันที่ของรายการที่ผู้รับเหมาคนนี้ควรใช้ตอนนี้: เมื่อวาน (กะข้ามคืนที่ยังไม่ออก) หรือวันนี้
create or replace function public.kiosk_work_date(p_worker uuid) returns date
language sql stable security definer set search_path = '' as $$
  select case when exists (
      select 1 from public.attendance a
      where a.worker_id = p_worker and a.work_date = public.bkk_today() - 1
        and a.check_out is null and a.check_in > now() - interval '20 hours')
    and not exists (select 1 from public.attendance a where a.worker_id = p_worker and a.work_date = public.bkk_today())
  then public.bkk_today() - 1 else public.bkk_today() end;
$$;

create or replace function public.kiosk_team(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t record; v_today date := public.bkk_today(); v_overnight boolean;
begin
  select tm.id, tm.name, j.job_no, j.title, j.status, j.start_date, j.end_date into t
  from public.teams tm join public.jobs j on j.id = tm.job_id
  where tm.qr_token = p_token and char_length(p_token) = 48;
  if not found then return jsonb_build_object('ok', false, 'error', 'QR ไม่ถูกต้อง'); end if;
  -- มีคนในทีมเข้างานเมื่อวานแล้วยังไม่ออก (กะข้ามคืน)
  v_overnight := exists (select 1 from public.attendance a where a.team_id = t.id and a.work_date = v_today - 1
                         and a.check_out is null and a.check_in > now() - interval '20 hours');
  if t.status <> 'active' or (v_today not between t.start_date and t.end_date and not v_overnight) then
    return jsonb_build_object('ok', false, 'error', 'จ็อบนี้ไม่ได้เปิดลงเวลาในวันนี้');
  end if;
  if not public.day_is_open(t.id, v_today) and not v_overnight then
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
declare v_date date := public.kiosk_work_date(p_worker); v_max int; p record; w record;
        v_overnight boolean := v_date < public.bkk_today();
begin
  select x.id, x.full_name, x.team_id, x.job_id into w
  from public.workers x join public.teams tm on tm.id = x.team_id join public.jobs j on j.id = x.job_id
  where x.id = p_worker and x.active and tm.qr_token = p_token and char_length(p_token) = 48
    and j.status = 'active' and v_date between j.start_date and j.end_date;
  if not found then return jsonb_build_object('ok', false, 'error', 'ไม่พบชื่อในทีมนี้'); end if;
  if not public.day_is_open(w.team_id, v_date) then
    return jsonb_build_object('ok', false, 'error', 'หัวหน้างานยังไม่เปิดลงเวลาวันนี้ กรุณาแจ้งหัวหน้างาน');
  end if;

  select s.pin_max_attempts into v_max from public.app_settings s where s.id = 1;
  select * into p from public.daily_pins d where d.worker_id = p_worker and d.work_date = v_date for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'หัวหน้างานยังไม่ได้สร้างรหัสของวันนี้'); end if;
  if p.failed_attempts >= v_max then
    return jsonb_build_object('ok', false, 'locked', true, 'error', 'กรอกรหัสผิดเกินกำหนด กรุณาติดต่อหัวหน้างาน');
  end if;
  if p_pin is null or p.pin <> p_pin then
    update public.daily_pins set failed_attempts = failed_attempts + 1
      where worker_id = p_worker and work_date = v_date;
    return jsonb_build_object('ok', false, 'error',
      case when v_overnight then 'รหัสไม่ถูกต้อง (กะข้ามคืน ใช้ PIN ของเมื่อวาน)' else 'รหัสไม่ถูกต้อง' end,
      'remaining', greatest(v_max - p.failed_attempts - 1, 0));
  end if;
  return jsonb_build_object('ok', true, 'worker_id', w.id, 'name', w.full_name, 'team_id', w.team_id,
                            'job_id', w.job_id, 'today', v_date, 'overnight', v_overnight);
end;
$$;

create or replace function public.kiosk_status(p_token text, p_worker uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r jsonb; a record;
begin
  r := public.kiosk_check_pin(p_token, p_worker, p_pin);
  if not (r ->> 'ok')::boolean then return r; end if;
  select x.check_in, x.check_out into a from public.attendance x
  where x.worker_id = p_worker and x.work_date = (r ->> 'today')::date;
  return jsonb_build_object('ok', true, 'name', r ->> 'name',
    'check_in', a.check_in, 'check_out', a.check_out, 'server_time', now(),
    'work_date', r ->> 'today', 'overnight', (r ->> 'overnight')::boolean);
end;
$$;

create or replace function public.kiosk_clock(p_token text, p_worker uuid, p_pin text, p_action text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r jsonb; a record; v_now timestamptz := now(); v_sheet record;
begin
  r := public.kiosk_check_pin(p_token, p_worker, p_pin);
  if not (r ->> 'ok')::boolean then return r; end if;

  select d.supervisor_approved_at, d.planner_approved_at into v_sheet from public.day_sheets d
  where d.team_id = (r ->> 'team_id')::uuid and d.work_date = (r ->> 'today')::date;
  if v_sheet.supervisor_approved_at is not null or v_sheet.planner_approved_at is not null then
    return jsonb_build_object('ok', false, 'error', 'ใบลงเวลาวันนี้ถูกอนุมัติแล้ว กรุณาติดต่อหัวหน้างาน');
  end if;

  select x.id, x.check_in, x.check_out into a from public.attendance x
  where x.worker_id = p_worker and x.work_date = (r ->> 'today')::date for update;

  if p_action = 'in' then
    if (r ->> 'overnight')::boolean then
      return jsonb_build_object('ok', false, 'error', 'ยังไม่ได้ลงเวลาออกของเมื่อวาน กรุณาลงเวลาออกก่อน');
    end if;
    if found then return jsonb_build_object('ok', false, 'error', 'วันนี้ลงเวลาเข้างานไปแล้ว'); end if;
    insert into public.attendance (worker_id, job_id, team_id, work_date, check_in, source)
    values (p_worker, (r ->> 'job_id')::uuid, (r ->> 'team_id')::uuid, (r ->> 'today')::date, v_now, 'self');
  elsif p_action = 'out' then
    if not found then return jsonb_build_object('ok', false, 'error', 'ยังไม่ได้ลงเวลาเข้างาน'); end if;
    if a.check_out is not null then return jsonb_build_object('ok', false, 'error', 'วันนี้ลงเวลาออกไปแล้ว'); end if;
    if v_now < a.check_in + interval '1 minute' then
      return jsonb_build_object('ok', false, 'error', 'เพิ่งลงเวลาเข้า กรุณารอสักครู่');
    end if;
    update public.attendance set check_out = v_now where id = a.id;
  else
    return jsonb_build_object('ok', false, 'error', 'คำสั่งไม่ถูกต้อง');
  end if;
  return jsonb_build_object('ok', true, 'action', p_action, 'at', v_now, 'name', r ->> 'name');
end;
$$;

-- กันกะยาวผิดปกติ (ลืมกดออกหลายวัน) จากการแก้ไขมือ
do $$ begin
  alter table public.attendance add constraint attendance_max_shift check (check_out is null or check_out < check_in + interval '24 hours');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2) ชื่อจริงและลายเซ็น (รูป PNG แบบ data URL ไม่เกิน ~150KB)
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists signature_png text;
do $$ begin
  alter table public.profiles add constraint profiles_signature_png check (
    signature_png is null or (signature_png like 'data:image/png;base64,%' and char_length(signature_png) <= 200000));
exception when duplicate_object then null; end $$;

-- แก้โปรไฟล์ตัวเองได้ (ชื่อและลายเซ็น) — ตำแหน่ง/สถานะ/อีเมลถูกล็อกด้วย guard_profiles อยู่แล้ว
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() and public.is_staff()) with check (id = auth.uid() and public.is_staff());

-- ---------- สิทธิ์ ----------
revoke execute on function public.kiosk_work_date(uuid) from public, anon, authenticated;
revoke execute on function public.kiosk_check_pin(text, uuid, text) from public, anon, authenticated;
grant execute on function public.kiosk_team(text), public.kiosk_status(text, uuid, text),
  public.kiosk_clock(text, uuid, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

-- =====================================================================
-- OSA Contractor Timesheet — โครงสร้างฐานข้อมูล สิทธิ์ และ workflow
-- รันใน Supabase: Dashboard > SQL Editor > วางทั้งไฟล์ > Run (รันครั้งเดียวบน project ใหม่)
--
-- หลักความปลอดภัย:
--  * ทุกตารางเปิด RLS และ anon (คนไม่ล็อกอิน) อ่าน/เขียนตารางตรงๆ ไม่ได้เลย
--  * ผู้รับเหมาเข้าถึงได้เฉพาะผ่านฟังก์ชัน kiosk_* ที่ตรวจ QR token + PIN รายวัน
--  * พนักงานต้องมี role ใน profiles ถึงจะเห็นข้อมูล (สมัครเองได้ก็ไม่มีสิทธิ์อะไร)
--  * admin / purchase ต้องยืนยันตัวตน 2 ชั้น (TOTP) เมื่อเปิด require_mfa
--  * การเปลี่ยนแปลงสำคัญทุกอย่างถูกบันทึกใน audit_log
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- ประเภทและตาราง
-- ---------------------------------------------------------------------

create type public.app_role as enum ('admin', 'supervisor', 'planner', 'purchase');

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text not null default '',
  role        public.app_role,              -- null = ยังไม่ได้รับสิทธิ์ใดๆ
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.app_settings (
  id                     int primary key default 1 check (id = 1),
  normal_hours           numeric(4,2) not null default 8,
  lunch_start            time not null default '12:00',
  lunch_end              time not null default '13:00',
  evening_break_minutes  int not null default 30 check (evening_break_minutes between 0 and 180),
  round_minutes          int not null default 30 check (round_minutes in (1, 5, 10, 15, 30, 60)),
  grace_minutes          int not null default 5 check (grace_minutes between 0 and 29),
  wht_rate               numeric(5,2) not null default 3 check (wht_rate between 0 and 100),
  pin_max_attempts       int not null default 5 check (pin_max_attempts between 3 and 10),
  require_mfa            boolean not null default true,
  company_name           text not null default 'OSA Valve Services (Thailand) Co., Ltd.',
  updated_at             timestamptz not null default now()
);
insert into public.app_settings (id) values (1);

create table public.holidays (
  holiday_date date primary key,
  name         text not null
);

create table public.jobs (
  id               uuid primary key default gen_random_uuid(),
  job_no           text not null unique check (char_length(job_no) between 1 and 40),
  title            text not null check (char_length(title) between 1 and 200),   -- ลูกค้า/หน้างาน เช่น PTT GSP6
  contractor_name  text check (char_length(contractor_name) <= 200),             -- ชุดผู้รับเหมา/ผู้รับเงิน
  location         text check (char_length(location) <= 200),
  start_date       date not null,
  end_date         date not null,
  workweek         smallint not null default 6 check (workweek in (5, 6)),       -- purchase เลือก
  evening_break    boolean not null default true,                               -- purchase เลือก
  status           text not null default 'active' check (status in ('active', 'closed')),
  created_by       uuid default auth.uid() references public.profiles(id),
  created_at       timestamptz not null default now(),
  check (end_date >= start_date)
);

create table public.teams (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references public.jobs(id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 60),
  supervisor_id  uuid references public.profiles(id),
  qr_token       text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  created_at     timestamptz not null default now(),
  unique (job_id, name)
);
create index teams_supervisor_idx on public.teams (supervisor_id);

create table public.workers (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs(id) on delete cascade,
  team_id     uuid not null references public.teams(id),
  full_name   text not null check (char_length(full_name) between 2 and 120),
  position    text not null default 'T/C' check (char_length(position) between 1 and 40),
  active      boolean not null default true,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index workers_team_idx on public.workers (team_id);
create index workers_job_idx on public.workers (job_id);

create table public.worker_rates (
  worker_id   uuid primary key references public.workers(id) on delete cascade,
  day_rate    numeric(12,2) not null check (day_rate >= 0 and day_rate <= 100000),
  updated_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now()
);

-- PIN 4 หลัก สุ่มใหม่ทุกคนทุกวัน (หมดอายุเมื่อจบวัน) — เห็นได้เฉพาะหัวหน้างานของจ็อบนั้นและแอดมิน
create table public.daily_pins (
  worker_id        uuid not null references public.workers(id) on delete cascade,
  work_date        date not null,
  pin              text not null check (pin ~ '^[0-9]{4}$'),
  failed_attempts  int not null default 0,
  created_at       timestamptz not null default now(),
  primary key (worker_id, work_date)
);

create table public.attendance (
  id          uuid primary key default gen_random_uuid(),
  worker_id   uuid not null references public.workers(id) on delete cascade,
  job_id      uuid not null references public.jobs(id) on delete cascade,
  team_id     uuid not null references public.teams(id),
  work_date   date not null,
  check_in    timestamptz not null,
  check_out   timestamptz,
  source      text not null default 'self' check (source in ('self', 'supervisor')),
  note        text check (char_length(note) <= 300),
  updated_by  uuid,
  updated_at  timestamptz not null default now(),
  unique (worker_id, work_date),
  check (check_out is null or check_out > check_in)
);
create index attendance_job_date_idx on public.attendance (job_id, work_date);
create index attendance_team_date_idx on public.attendance (team_id, work_date);

-- ใบลงเวลารายวันต่อทีม: ต้องอนุมัติ 2 คน (หัวหน้างาน + planner)
create table public.day_sheets (
  id                      uuid primary key default gen_random_uuid(),
  job_id                  uuid not null references public.jobs(id) on delete cascade,
  team_id                 uuid not null references public.teams(id) on delete cascade,
  work_date               date not null,
  supervisor_approved_by  uuid references public.profiles(id),
  supervisor_approved_at  timestamptz,
  planner_approved_by     uuid references public.profiles(id),
  planner_approved_at     timestamptz,
  rejected_by             uuid references public.profiles(id),
  rejected_at             timestamptz,
  reject_reason           text,
  created_at              timestamptz not null default now(),
  unique (team_id, work_date)
);
create index day_sheets_job_idx on public.day_sheets (job_id, work_date);

create table public.allowances (
  id          uuid primary key default gen_random_uuid(),
  worker_id   uuid not null references public.workers(id) on delete cascade,
  job_id      uuid not null references public.jobs(id) on delete cascade,
  work_date   date not null,
  kind        text not null default 'ค่ารถ/ค่าเดินทาง' check (char_length(kind) between 1 and 60),
  amount      numeric(12,2) not null check (amount >= 0 and amount <= 100000),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (worker_id, work_date, kind)
);
create index allowances_job_idx on public.allowances (job_id, work_date);

-- ใบคิดราคา (ต่อจ็อบ ต่อช่วงวันที่)
create table public.cost_sheets (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references public.jobs(id) on delete cascade,
  period_from    date not null,
  period_to      date not null,
  status         text not null default 'draft' check (status in ('draft', 'submitted', 'approved')),
  revision       int not null default 0,
  reject_reason  text,
  rejected_by    uuid references public.profiles(id),
  rejected_at    timestamptz,
  snapshot       jsonb,              -- ตัวเลขที่ถูกล็อกตอนส่งอนุมัติ (ใช้พิมพ์เอกสาร)
  subtotal       numeric(14,2),
  wht_amount     numeric(14,2),
  net_total      numeric(14,2),
  created_by     uuid default auth.uid() references public.profiles(id),
  created_at     timestamptz not null default now(),
  submitted_by   uuid references public.profiles(id),
  submitted_at   timestamptz,
  approved_at    timestamptz,
  check (period_to >= period_from)
);
create index cost_sheets_job_idx on public.cost_sheets (job_id);

create table public.cost_sheet_approvals (
  cost_sheet_id  uuid not null references public.cost_sheets(id) on delete cascade,
  supervisor_id  uuid not null references public.profiles(id),
  approved_at    timestamptz not null default now(),
  primary key (cost_sheet_id, supervisor_id)
);

create table public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       uuid default auth.uid(),
  table_name  text not null,
  row_id      text,
  action      text not null,
  old_data    jsonb,
  new_data    jsonb
);
create index audit_log_at_idx on public.audit_log (at desc);

-- ---------------------------------------------------------------------
-- ฟังก์ชันช่วยเรื่องสิทธิ์ (security definer เพื่ออ่าน profiles/teams ได้โดยไม่ติด RLS)
-- ---------------------------------------------------------------------

create function public.bkk_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Bangkok')::date;
$$;

create function public.my_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.active;
$$;

create function public.mfa_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when public.my_role() in ('admin', 'purchase')
         and (select s.require_mfa from public.app_settings s where s.id = 1)
      then coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    else true end;
$$;

create function public.has_role(variadic roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() = any(roles), false) and public.mfa_ok();
$$;

create function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.my_role() is not null and public.mfa_ok();
$$;

create function public.is_job_supervisor(p_job uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.my_role() = 'supervisor' and exists (
    select 1 from public.teams t where t.job_id = p_job and t.supervisor_id = auth.uid());
$$;

create function public.can_see_job(p_job uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role('admin', 'planner', 'purchase') or public.is_job_supervisor(p_job);
$$;

create function public.can_manage_job_workers(p_job uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role('admin') or public.is_job_supervisor(p_job);
$$;

create function public.is_holiday(p_date date, p_workweek int) returns boolean
language sql stable security definer set search_path = '' as $$
  select extract(isodow from p_date) = 7
      or (p_workweek = 5 and extract(isodow from p_date) = 6)
      or exists (select 1 from public.holidays h where h.holiday_date = p_date);
$$;

-- ---------------------------------------------------------------------
-- สูตรคำนวณชั่วโมง (แหล่งเดียวของความจริง ทั้งหน้าจอและเอกสาร)
--   ชั่วโมงทำงาน = เวลาออก − เวลาเข้า − ช่วงพักเที่ยงที่คร่อม (12:00–13:00)
--   ปกติ = ไม่เกิน 8 ชม.แรก
--   OT  = ส่วนที่เกิน 8 ชม. − พักเย็น 30 นาที (ถ้าจ็อบติ๊ก "พัก")
--   ปัดลงทีละ 30 นาที โดยเผื่อ 5 นาที (เช่น 7:57 → 8 ชม., 2:50 → 2.5 ชม.)
-- ---------------------------------------------------------------------

create function public.calc_hours(
  p_in timestamptz, p_out timestamptz, p_evening_break boolean,
  p_normal_min int, p_lunch_start time, p_lunch_end time,
  p_break_min int, p_round_min int, p_grace_min int)
returns table (normal_h numeric, ot_h numeric)
language plpgsql immutable set search_path = '' as $$
declare
  li timestamp; lo timestamp; ls timestamp; le timestamp;
  worked int; ot int;
begin
  if p_in is null or p_out is null or p_out <= p_in then
    return query select 0::numeric, 0::numeric; return;
  end if;
  li := p_in at time zone 'Asia/Bangkok';
  lo := p_out at time zone 'Asia/Bangkok';
  ls := li::date + p_lunch_start;
  le := li::date + p_lunch_end;
  worked := floor(extract(epoch from (lo - li)) / 60)
          - greatest(0, floor(extract(epoch from (least(lo, le) - greatest(li, ls))) / 60));
  ot := worked - p_normal_min;
  if ot > 0 and p_evening_break then ot := ot - p_break_min; end if;
  ot := greatest(ot, 0);
  return query select
    (floor((least(worked, p_normal_min) + p_grace_min)::numeric / p_round_min) * p_round_min / 60.0)::numeric(6,2),
    (floor((ot + p_grace_min)::numeric / p_round_min) * p_round_min / 60.0)::numeric(6,2);
end;
$$;

create view public.v_attendance_hours with (security_invoker = true) as
select a.id, a.worker_id, a.job_id, a.team_id, a.work_date, a.check_in, a.check_out,
       a.source, a.note, a.updated_by, a.updated_at,
       j.workweek, j.evening_break,
       public.is_holiday(a.work_date, j.workweek) as holiday,
       h.normal_h, h.ot_h
from public.attendance a
join public.jobs j on j.id = a.job_id
cross join public.app_settings s
cross join lateral public.calc_hours(
  a.check_in, a.check_out, j.evening_break,
  (s.normal_hours * 60)::int, s.lunch_start, s.lunch_end,
  s.evening_break_minutes, s.round_minutes, s.grace_minutes) h
where s.id = 1;

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

-- ---------------------------------------------------------------------
-- Triggers: profile อัตโนมัติ, ตรวจความถูกต้อง, ล็อกข้อมูลที่อนุมัติแล้ว, audit
-- ---------------------------------------------------------------------

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.guard_profiles() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.id = auth.uid() and (new.role is distinct from old.role or new.active is distinct from old.active) then
    raise exception 'ไม่สามารถเปลี่ยนสิทธิ์หรือปิดบัญชีของตัวเองได้';
  end if;
  new.email := old.email;
  return new;
end;
$$;
create trigger guard_profiles before update on public.profiles
  for each row execute function public.guard_profiles();

-- purchase แก้ได้เฉพาะ workweek / evening_break ของจ็อบ
create function public.guard_jobs() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('admin')
     and (to_jsonb(new) - 'workweek' - 'evening_break') <> (to_jsonb(old) - 'workweek' - 'evening_break') then
    raise exception 'แก้ไขได้เฉพาะเงื่อนไขการคิดราคา';
  end if;
  return new;
end;
$$;
create trigger guard_jobs before update on public.jobs
  for each row execute function public.guard_jobs();

create function public.guard_workers() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_job uuid;
begin
  select t.job_id into v_job from public.teams t where t.id = new.team_id;
  if tg_op = 'UPDATE' and new.job_id <> old.job_id then
    raise exception 'ย้ายคนข้ามจ็อบไม่ได้';
  end if;
  if v_job is distinct from new.job_id then
    raise exception 'ทีมไม่อยู่ในจ็อบนี้';
  end if;
  new.full_name := btrim(regexp_replace(new.full_name, '\s+', ' ', 'g'));
  return new;
end;
$$;
create trigger guard_workers before insert or update on public.workers
  for each row execute function public.guard_workers();

-- ข้อมูลวันที่ถูกส่งคิดราคาแล้ว ห้ามแก้
create function public.period_frozen(p_job uuid, p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.cost_sheets c
                 where c.job_id = p_job and c.status in ('submitted', 'approved')
                   and p_date between c.period_from and c.period_to);
$$;

create function public.guard_attendance() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record; v_sheet public.day_sheets;
begin
  -- คำนวณ job/team/วันที่ จากข้อมูลจริงก่อน (ไม่เชื่อค่าที่ client ส่งมา) แล้วจึงตรวจการล็อก
  if tg_op in ('INSERT', 'UPDATE') then
    select w.job_id into new.job_id from public.workers w where w.id = new.worker_id;
    if new.job_id is null then raise exception 'ไม่พบผู้รับเหมา'; end if;
    if tg_op = 'INSERT' and new.team_id is null then
      select w.team_id into new.team_id from public.workers w where w.id = new.worker_id;
    end if;
    if not exists (select 1 from public.teams t where t.id = new.team_id and t.job_id = new.job_id) then
      raise exception 'ทีมไม่อยู่ในจ็อบนี้';
    end if;
    new.work_date := (new.check_in at time zone 'Asia/Bangkok')::date;
  end if;

  for r in select * from (values (old.team_id, old.work_date, old.job_id), (new.team_id, new.work_date, new.job_id)) v(team_id, work_date, job_id)
           where v.team_id is not null loop
    select * into v_sheet from public.day_sheets d where d.team_id = r.team_id and d.work_date = r.work_date;
    if v_sheet.supervisor_approved_at is not null or v_sheet.planner_approved_at is not null then
      raise exception 'ใบลงเวลาวันที่ % ถูกอนุมัติแล้ว ต้องยกเลิกอนุมัติก่อนแก้ไข', to_char(r.work_date, 'DD/MM/YYYY');
    end if;
    if public.period_frozen(r.job_id, r.work_date) then
      raise exception 'วันที่ % อยู่ในใบคิดราคาที่ส่งแล้ว', to_char(r.work_date, 'DD/MM/YYYY');
    end if;
  end loop;

  if tg_op in ('INSERT', 'UPDATE') then
    new.updated_by := auth.uid();
    new.updated_at := now();
    if auth.uid() is not null then new.source := 'supervisor'; end if;
    return new;
  end if;
  return old;
end;
$$;
create trigger guard_attendance before insert or update or delete on public.attendance
  for each row execute function public.guard_attendance();

create function public.ensure_day_sheet() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.day_sheets (job_id, team_id, work_date)
  values (new.job_id, new.team_id, new.work_date)
  on conflict (team_id, work_date) do nothing;
  return null;
end;
$$;
create trigger ensure_day_sheet after insert or update on public.attendance
  for each row execute function public.ensure_day_sheet();

create function public.guard_allowances() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    select w.job_id into new.job_id from public.workers w where w.id = new.worker_id;
    if new.job_id is null then raise exception 'ไม่พบผู้รับเหมา'; end if;
    if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  end if;
  for r in select * from (values (old.worker_id, old.work_date, old.job_id), (new.worker_id, new.work_date, new.job_id)) v(worker_id, work_date, job_id)
           where v.worker_id is not null loop
    if exists (select 1 from public.day_sheets d
               where d.job_id = r.job_id and d.work_date = r.work_date and d.planner_approved_at is not null
                 and d.team_id in (select a.team_id from public.attendance a where a.worker_id = r.worker_id and a.work_date = r.work_date
                                   union select w.team_id from public.workers w where w.id = r.worker_id)) then
      raise exception 'ใบลงเวลาวันที่ % ถูกอนุมัติแล้ว', to_char(r.work_date, 'DD/MM/YYYY');
    end if;
    if public.period_frozen(r.job_id, r.work_date) then
      raise exception 'วันที่ % อยู่ในใบคิดราคาที่ส่งแล้ว', to_char(r.work_date, 'DD/MM/YYYY');
    end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger guard_allowances before insert or update or delete on public.allowances
  for each row execute function public.guard_allowances();

create function public.force_creator() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.created_by := auth.uid();
  if tg_table_name = 'cost_sheets' then
    new.status := 'draft'; new.revision := 0; new.snapshot := null;
    new.subtotal := null; new.wht_amount := null; new.net_total := null;
    new.submitted_by := null; new.submitted_at := null; new.approved_at := null;
    new.reject_reason := null; new.rejected_by := null; new.rejected_at := null;
  end if;
  return new;
end;
$$;
create trigger force_creator before insert on public.jobs for each row execute function public.force_creator();
create trigger force_creator before insert on public.workers for each row execute function public.force_creator();
create trigger force_creator before insert on public.cost_sheets for each row execute function public.force_creator();

create function public.touch_rate() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;
create trigger touch_rate before insert or update on public.worker_rates
  for each row execute function public.touch_rate();

create function public.guard_cost_sheets() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- แก้ตรงได้เฉพาะใบที่ยังเป็น draft และเฉพาะช่วงวันที่ (สถานะเปลี่ยนผ่าน RPC เท่านั้น)
  if current_setting('app.cost_rpc', true) is distinct from 'on' then
    if old.status <> 'draft' then raise exception 'ใบคิดราคานี้ส่งแล้ว แก้ไขไม่ได้'; end if;
    if (to_jsonb(new) - 'period_from' - 'period_to') <> (to_jsonb(old) - 'period_from' - 'period_to') then
      raise exception 'แก้ไขได้เฉพาะช่วงวันที่';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_cost_sheets before update on public.cost_sheets
  for each row execute function public.guard_cost_sheets();

create function public.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (table_name, row_id, action, old_data, new_data)
  values (tg_table_name,
          coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id', to_jsonb(new) ->> 'worker_id', to_jsonb(old) ->> 'worker_id'),
          tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) - 'snapshot' end,
          case when tg_op <> 'DELETE' then to_jsonb(new) - 'snapshot' end);
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['profiles','app_settings','holidays','jobs','teams','workers','worker_rates',
                           'attendance','day_sheets','allowances','cost_sheets','cost_sheet_approvals'] loop
    execute format('create trigger audit after insert or update or delete on public.%I
                    for each row execute function public.audit()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table public.profiles             enable row level security;
alter table public.app_settings         enable row level security;
alter table public.holidays             enable row level security;
alter table public.jobs                 enable row level security;
alter table public.teams                enable row level security;
alter table public.workers              enable row level security;
alter table public.worker_rates         enable row level security;
alter table public.daily_pins           enable row level security;
alter table public.attendance           enable row level security;
alter table public.day_sheets           enable row level security;
alter table public.allowances           enable row level security;
alter table public.cost_sheets          enable row level security;
alter table public.cost_sheet_approvals enable row level security;
alter table public.audit_log            enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());
create policy profiles_update on public.profiles for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy settings_select on public.app_settings for select to authenticated using (public.is_staff());
create policy settings_update on public.app_settings for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy holidays_select on public.holidays for select to authenticated using (public.is_staff());
create policy holidays_write on public.holidays for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy jobs_select on public.jobs for select to authenticated using (public.can_see_job(id));
create policy jobs_insert on public.jobs for insert to authenticated with check (public.has_role('admin'));
create policy jobs_update on public.jobs for update to authenticated
  using (public.has_role('admin', 'purchase')) with check (public.has_role('admin', 'purchase'));
create policy jobs_delete on public.jobs for delete to authenticated using (public.has_role('admin'));

create policy teams_select on public.teams for select to authenticated using (public.can_see_job(job_id));
create policy teams_write on public.teams for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy workers_select on public.workers for select to authenticated using (public.can_see_job(job_id));
create policy workers_insert on public.workers for insert to authenticated
  with check (public.can_manage_job_workers(job_id));
create policy workers_update on public.workers for update to authenticated
  using (public.can_manage_job_workers(job_id)) with check (public.can_manage_job_workers(job_id));
create policy workers_delete on public.workers for delete to authenticated
  using (public.has_role('admin') and not exists (select 1 from public.attendance a where a.worker_id = workers.id));

create policy rates_select on public.worker_rates for select to authenticated
  using (exists (select 1 from public.workers w where w.id = worker_id and public.can_see_job(w.job_id)));
create policy rates_write on public.worker_rates for all to authenticated
  using (public.has_role('admin', 'purchase')) with check (public.has_role('admin', 'purchase'));

create policy pins_select on public.daily_pins for select to authenticated
  using (exists (select 1 from public.workers w where w.id = worker_id and public.can_manage_job_workers(w.job_id)));

create policy attendance_select on public.attendance for select to authenticated using (public.can_see_job(job_id));
create policy attendance_insert on public.attendance for insert to authenticated
  with check (public.can_manage_job_workers(job_id));
create policy attendance_update on public.attendance for update to authenticated
  using (public.can_manage_job_workers(job_id)) with check (public.can_manage_job_workers(job_id));
create policy attendance_delete on public.attendance for delete to authenticated
  using (public.can_manage_job_workers(job_id));

create policy day_sheets_select on public.day_sheets for select to authenticated using (public.can_see_job(job_id));

create policy allowances_select on public.allowances for select to authenticated using (public.can_see_job(job_id));
create policy allowances_write on public.allowances for all to authenticated
  using (public.has_role('admin', 'planner')) with check (public.has_role('admin', 'planner'));

create policy cost_select on public.cost_sheets for select to authenticated using (public.can_see_job(job_id));
create policy cost_insert on public.cost_sheets for insert to authenticated
  with check (public.has_role('admin', 'purchase') and status = 'draft' and snapshot is null);
create policy cost_update on public.cost_sheets for update to authenticated
  using (public.has_role('admin', 'purchase')) with check (public.has_role('admin', 'purchase'));
create policy cost_delete on public.cost_sheets for delete to authenticated
  using (public.has_role('admin', 'purchase') and status = 'draft');

create policy cost_appr_select on public.cost_sheet_approvals for select to authenticated
  using (exists (select 1 from public.cost_sheets c where c.id = cost_sheet_id and public.can_see_job(c.job_id)));

create policy audit_select on public.audit_log for select to authenticated using (public.has_role('admin'));

-- ---------------------------------------------------------------------
-- RPC: PIN รายวัน (หัวหน้างาน)
-- ---------------------------------------------------------------------

create function public.random_pin() returns text
language sql volatile set search_path = '' as $$
  select lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint & 2147483647) % 10000)::text, 4, '0');
$$;

-- สร้าง PIN วันนี้ให้ทุกคนในทีมที่ยังไม่มี (p_worker = สุ่มใหม่ให้คนเดียว และรีเซ็ตการล็อก)
create function public.generate_pins(p_team uuid, p_worker uuid default null)
returns int
language plpgsql security definer set search_path = '' as $$
declare v_job uuid; v_today date := public.bkk_today(); w record; v_pin text; n int := 0;
begin
  select t.job_id into v_job from public.teams t where t.id = p_team;
  if v_job is null or not public.can_manage_job_workers(v_job) then raise exception 'ไม่มีสิทธิ์'; end if;

  if p_worker is not null then
    delete from public.daily_pins p where p.worker_id = p_worker and p.work_date = v_today
      and exists (select 1 from public.workers x where x.id = p_worker and x.team_id = p_team);
  end if;

  for w in select x.id from public.workers x
           where x.team_id = p_team and x.active and (p_worker is null or x.id = p_worker)
             and not exists (select 1 from public.daily_pins p where p.worker_id = x.id and p.work_date = v_today) loop
    loop  -- ไม่ให้ PIN ซ้ำกันในทีมเดียวกัน (กันใช้รหัสตัวเองลงชื่อคนอื่น)
      v_pin := public.random_pin();
      exit when not exists (select 1 from public.daily_pins p join public.workers x on x.id = p.worker_id
                            where x.team_id = p_team and p.work_date = v_today and p.pin = v_pin);
    end loop;
    insert into public.daily_pins (worker_id, work_date, pin) values (w.id, v_today, v_pin);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------
-- RPC: หน้าลงเวลาผู้รับเหมา (ไม่ต้องล็อกอิน) — ใช้ QR token + PIN
-- คืนค่า {ok:false, error} แทนการ raise เพื่อให้นับครั้งที่กรอกผิดได้จริง
-- ---------------------------------------------------------------------

create function public.kiosk_team(p_token text) returns jsonb
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
  return jsonb_build_object('ok', true, 'job_no', t.job_no, 'job_title', t.title, 'team', t.name,
    'today', v_today,
    'workers', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.full_name) order by w.full_name)
                         from public.workers w where w.team_id = t.id and w.active), '[]'::jsonb));
end;
$$;

create function public.kiosk_check_pin(p_token text, p_worker uuid, p_pin text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_today date := public.bkk_today(); v_max int; p record; w record;
begin
  select x.id, x.full_name, x.team_id, x.job_id into w
  from public.workers x join public.teams tm on tm.id = x.team_id join public.jobs j on j.id = x.job_id
  where x.id = p_worker and x.active and tm.qr_token = p_token and char_length(p_token) = 48
    and j.status = 'active' and v_today between j.start_date and j.end_date;
  if not found then return jsonb_build_object('ok', false, 'error', 'ไม่พบชื่อในทีมนี้'); end if;

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

create function public.kiosk_status(p_token text, p_worker uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r jsonb; a record;
begin
  r := public.kiosk_check_pin(p_token, p_worker, p_pin);
  if not (r ->> 'ok')::boolean then return r; end if;
  select x.check_in, x.check_out into a from public.attendance x
  where x.worker_id = p_worker and x.work_date = (r ->> 'today')::date;
  return jsonb_build_object('ok', true, 'name', r ->> 'name',
    'check_in', a.check_in, 'check_out', a.check_out, 'server_time', now());
end;
$$;

create function public.kiosk_clock(p_token text, p_worker uuid, p_pin text, p_action text) returns jsonb
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

-- ---------------------------------------------------------------------
-- RPC: อนุมัติใบลงเวลารายวัน (หัวหน้างาน + planner)
-- ---------------------------------------------------------------------

create function public.approve_day(p_sheet uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.day_sheets; v_open int; v_sup uuid;
begin
  select * into d from public.day_sheets where id = p_sheet for update;
  if not found then raise exception 'ไม่พบใบลงเวลา'; end if;
  select t.supervisor_id into v_sup from public.teams t where t.id = d.team_id;
  select count(*) into v_open from public.attendance a
    where a.team_id = d.team_id and a.work_date = d.work_date and a.check_out is null;
  if v_open > 0 then raise exception 'ยังมี % คนที่ไม่ได้ลงเวลาออก', v_open; end if;
  if d.work_date > public.bkk_today() then raise exception 'ยังไม่ถึงวันที่'; end if;

  if public.has_role('supervisor') and v_sup = auth.uid() then
    update public.day_sheets set supervisor_approved_by = auth.uid(), supervisor_approved_at = now(),
      rejected_by = null, rejected_at = null, reject_reason = null where id = p_sheet;
  elsif public.has_role('planner') then
    if d.supervisor_approved_at is null then raise exception 'รอหัวหน้างานอนุมัติก่อน'; end if;
    update public.day_sheets set planner_approved_by = auth.uid(), planner_approved_at = now() where id = p_sheet;
  else
    raise exception 'ไม่มีสิทธิ์อนุมัติใบนี้';
  end if;
end;
$$;

create function public.unapprove_day(p_sheet uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.day_sheets; v_sup uuid;
begin
  select * into d from public.day_sheets where id = p_sheet for update;
  if not found then raise exception 'ไม่พบใบลงเวลา'; end if;
  if public.period_frozen(d.job_id, d.work_date) then raise exception 'วันนี้อยู่ในใบคิดราคาที่ส่งแล้ว'; end if;
  select t.supervisor_id into v_sup from public.teams t where t.id = d.team_id;

  if public.has_role('admin') then
    update public.day_sheets set supervisor_approved_by = null, supervisor_approved_at = null,
      planner_approved_by = null, planner_approved_at = null where id = p_sheet;
  elsif public.has_role('planner') and d.planner_approved_at is not null then
    update public.day_sheets set planner_approved_by = null, planner_approved_at = null where id = p_sheet;
  elsif public.has_role('supervisor') and v_sup = auth.uid() and d.planner_approved_at is null then
    update public.day_sheets set supervisor_approved_by = null, supervisor_approved_at = null where id = p_sheet;
  else
    raise exception 'ยกเลิกไม่ได้ (planner อนุมัติแล้ว ต้องให้ planner หรือแอดมินยกเลิก)';
  end if;
end;
$$;

create function public.reject_day(p_sheet uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.day_sheets;
begin
  if not public.has_role('planner', 'admin') then raise exception 'ไม่มีสิทธิ์'; end if;
  if char_length(coalesce(btrim(p_reason), '')) < 3 then raise exception 'กรุณาระบุเหตุผล'; end if;
  select * into d from public.day_sheets where id = p_sheet for update;
  if not found then raise exception 'ไม่พบใบลงเวลา'; end if;
  if public.period_frozen(d.job_id, d.work_date) then raise exception 'วันนี้อยู่ในใบคิดราคาที่ส่งแล้ว'; end if;
  update public.day_sheets set supervisor_approved_by = null, supervisor_approved_at = null,
    planner_approved_by = null, planner_approved_at = null,
    rejected_by = auth.uid(), rejected_at = now(), reject_reason = left(btrim(p_reason), 500)
  where id = p_sheet;
end;
$$;

-- ---------------------------------------------------------------------
-- RPC: ใบคิดราคา
-- ---------------------------------------------------------------------

-- สร้างตัวเลขทั้งหมดของจ็อบในช่วงวันที่ (ใช้ทั้งดูตัวอย่างและล็อกตอนส่ง)
create function public.cost_preview(p_job uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.app_settings; j public.jobs; v_workers jsonb; v_sub numeric; v_pending int; v_missing int;
begin
  if not public.can_see_job(p_job) then raise exception 'ไม่มีสิทธิ์'; end if;
  select * into s from public.app_settings where id = 1;
  select * into j from public.jobs where id = p_job;

  with d as (
    select v.worker_id, v.work_date, v.holiday, v.check_in, v.check_out, v.normal_h, v.ot_h,
           coalesce(ds.supervisor_approved_at is not null and ds.planner_approved_at is not null, false) as approved
    from public.v_attendance_hours v
    left join public.day_sheets ds on ds.team_id = v.team_id and ds.work_date = v.work_date
    where v.job_id = p_job and v.work_date between p_from and p_to
  ),
  base as (
    select w.id, w.full_name, w.position, t.name as team_name, coalesce(r.day_rate, 0) as day_rate,
           coalesce(r.day_rate, 0) / s.normal_hours as unit,
           dd.days, coalesce(dd.n1, 0) n1, coalesce(dd.ot15, 0) ot15, coalesce(dd.h2, 0) h2, coalesce(dd.h3, 0) h3,
           coalesce(dd.work_days, 0) work_days,
           coalesce(aa.allowances, '[]'::jsonb) allowances, coalesce(aa.allow_total, 0) allow_total
    from public.workers w
    join public.teams t on t.id = w.team_id
    left join public.worker_rates r on r.worker_id = w.id
    left join lateral (
      select jsonb_agg(jsonb_build_object('date', d.work_date, 'holiday', d.holiday, 'in', d.check_in,
               'out', d.check_out, 'normal', d.normal_h, 'ot', d.ot_h, 'approved', d.approved) order by d.work_date) days,
             sum(d.normal_h) filter (where not d.holiday) n1, sum(d.ot_h) filter (where not d.holiday) ot15,
             sum(d.normal_h) filter (where d.holiday) h2, sum(d.ot_h) filter (where d.holiday) h3,
             count(*) filter (where d.check_out is not null) work_days
      from d where d.worker_id = w.id) dd on true
    left join lateral (
      select jsonb_agg(jsonb_build_object('date', a.work_date, 'kind', a.kind, 'amount', a.amount) order by a.work_date, a.kind) allowances,
             sum(a.amount) allow_total
      from public.allowances a where a.worker_id = w.id and a.work_date between p_from and p_to) aa on true
    where w.job_id = p_job and (dd.days is not null or aa.allowances is not null)
  ),
  priced as (
    select b.*,
      round(b.n1 * b.unit, 2) a1, round(b.ot15 * b.unit * 1.5, 2) a15,
      round(b.h2 * b.unit * 2, 2) a2, round(b.h3 * b.unit * 3, 2) a3
    from base b
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'worker_id', p.id, 'name', p.full_name, 'position', p.position, 'team', p.team_name,
           'day_rate', p.day_rate, 'unit', round(p.unit, 4), 'work_days', p.work_days,
           'hours', jsonb_build_object('n1', p.n1, 'ot15', p.ot15, 'h2', p.h2, 'h3', p.h3),
           'amounts', jsonb_build_object('n1', p.a1, 'ot15', p.a15, 'h2', p.a2, 'h3', p.a3),
           'allowance_total', p.allow_total,
           'total', p.a1 + p.a15 + p.a2 + p.a3 + p.allow_total,
           'days', coalesce(p.days, '[]'::jsonb), 'allowances', p.allowances)
           order by p.team_name, p.full_name), '[]'::jsonb),
         coalesce(sum(p.a1 + p.a15 + p.a2 + p.a3 + p.allow_total), 0)
    into v_workers, v_sub
  from priced p;

  select count(*) into v_pending from public.day_sheets ds
  where ds.job_id = p_job and ds.work_date between p_from and p_to
    and (ds.supervisor_approved_at is null or ds.planner_approved_at is null);
  select count(*) into v_missing from jsonb_array_elements(v_workers) x
  where (x ->> 'day_rate')::numeric <= 0
    and ((x -> 'hours' ->> 'n1')::numeric + (x -> 'hours' ->> 'ot15')::numeric
       + (x -> 'hours' ->> 'h2')::numeric + (x -> 'hours' ->> 'h3')::numeric) > 0;

  return jsonb_build_object(
    'job', jsonb_build_object('id', j.id, 'job_no', j.job_no, 'title', j.title, 'contractor', j.contractor_name,
                              'location', j.location, 'workweek', j.workweek, 'evening_break', j.evening_break),
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'settings', jsonb_build_object('normal_hours', s.normal_hours, 'wht_rate', s.wht_rate,
                                   'break_minutes', s.evening_break_minutes, 'round_minutes', s.round_minutes,
                                   'company', s.company_name),
    'holidays', coalesce((select jsonb_agg(h.holiday_date order by h.holiday_date) from public.holidays h
                          where h.holiday_date between p_from and p_to), '[]'::jsonb),
    'workers', v_workers,
    'subtotal', v_sub,
    'wht', round(v_sub * s.wht_rate / 100, 2),
    'net', v_sub - round(v_sub * s.wht_rate / 100, 2),
    'pending_days', v_pending,
    'missing_rates', v_missing,
    'generated_at', now());
end;
$$;

create function public.submit_cost_sheet(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cost_sheets; v jsonb;
begin
  if not public.has_role('purchase', 'admin') then raise exception 'ไม่มีสิทธิ์'; end if;
  select * into c from public.cost_sheets where id = p_id;
  if not found then raise exception 'ไม่พบใบคิดราคา'; end if;
  perform pg_advisory_xact_lock(hashtext('cost:' || c.job_id::text));
  select * into c from public.cost_sheets where id = p_id for update;
  if c.status <> 'draft' then raise exception 'ใบนี้ไม่อยู่ในสถานะร่าง'; end if;
  if exists (select 1 from public.cost_sheets o where o.job_id = c.job_id and o.id <> c.id
             and o.status in ('submitted', 'approved')
             and daterange(o.period_from, o.period_to, '[]') && daterange(c.period_from, c.period_to, '[]')) then
    raise exception 'ช่วงวันที่ซ้อนกับใบคิดราคาอื่นที่ส่งแล้ว';
  end if;
  v := public.cost_preview(c.job_id, c.period_from, c.period_to);
  if (v ->> 'pending_days')::int > 0 then
    raise exception 'ยังมีใบลงเวลารายวัน % ใบที่อนุมัติไม่ครบ', v ->> 'pending_days';
  end if;
  if (v ->> 'missing_rates')::int > 0 then
    raise exception 'ยังไม่ได้ใส่ค่าแรง % คน', v ->> 'missing_rates';
  end if;
  if jsonb_array_length(v -> 'workers') = 0 then raise exception 'ไม่มีข้อมูลในช่วงวันที่นี้'; end if;

  perform set_config('app.cost_rpc', 'on', true);
  delete from public.cost_sheet_approvals where cost_sheet_id = p_id;
  update public.cost_sheets set status = 'submitted', revision = revision + 1, snapshot = v,
    subtotal = (v ->> 'subtotal')::numeric, wht_amount = (v ->> 'wht')::numeric, net_total = (v ->> 'net')::numeric,
    submitted_by = auth.uid(), submitted_at = now(), reject_reason = null, rejected_by = null, rejected_at = null
  where id = p_id;
  perform set_config('app.cost_rpc', 'off', true);
end;
$$;

create function public.approve_cost_sheet(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.cost_sheets; v_need int; v_have int;
begin
  select * into c from public.cost_sheets where id = p_id for update;
  if not found or c.status <> 'submitted' then raise exception 'ใบนี้ไม่ได้รออนุมัติ'; end if;
  if not public.is_job_supervisor(c.job_id) then raise exception 'เฉพาะหัวหน้างานของจ็อบนี้'; end if;
  insert into public.cost_sheet_approvals (cost_sheet_id, supervisor_id) values (p_id, auth.uid())
    on conflict do nothing;
  select count(distinct t.supervisor_id) into v_need from public.teams t
    where t.job_id = c.job_id and t.supervisor_id is not null;
  select count(*) into v_have from public.cost_sheet_approvals a
    where a.cost_sheet_id = p_id
      and a.supervisor_id in (select t.supervisor_id from public.teams t where t.job_id = c.job_id);
  if v_have >= v_need then
    perform set_config('app.cost_rpc', 'on', true);
    update public.cost_sheets set status = 'approved', approved_at = now() where id = p_id;
    perform set_config('app.cost_rpc', 'off', true);
    return 'approved';
  end if;
  return 'waiting';
end;
$$;

create function public.reject_cost_sheet(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cost_sheets;
begin
  select * into c from public.cost_sheets where id = p_id for update;
  if not found or c.status <> 'submitted' then raise exception 'ใบนี้ไม่ได้รออนุมัติ'; end if;
  if not (public.is_job_supervisor(c.job_id) or public.has_role('admin')) then raise exception 'ไม่มีสิทธิ์'; end if;
  if char_length(coalesce(btrim(p_reason), '')) < 3 then raise exception 'กรุณาระบุเหตุผล'; end if;
  perform set_config('app.cost_rpc', 'on', true);
  delete from public.cost_sheet_approvals where cost_sheet_id = p_id;
  update public.cost_sheets set status = 'draft', reject_reason = left(btrim(p_reason), 500),
    rejected_by = auth.uid(), rejected_at = now() where id = p_id;
  perform set_config('app.cost_rpc', 'off', true);
end;
$$;

-- แอดมินเปิดใบที่อนุมัติ/ส่งแล้วกลับเป็นร่าง (เช่นต้องทำ Revise ใหม่) — บันทึกใน audit
create function public.reopen_cost_sheet(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('admin') then raise exception 'เฉพาะแอดมิน'; end if;
  if char_length(coalesce(btrim(p_reason), '')) < 3 then raise exception 'กรุณาระบุเหตุผล'; end if;
  perform set_config('app.cost_rpc', 'on', true);
  delete from public.cost_sheet_approvals where cost_sheet_id = p_id;
  update public.cost_sheets set status = 'draft', approved_at = null, reject_reason = left(btrim(p_reason), 500),
    rejected_by = auth.uid(), rejected_at = now() where id = p_id;
  perform set_config('app.cost_rpc', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------
-- RPC: Dashboard (ใช้สิทธิ์ของผู้เรียก — เห็นเฉพาะจ็อบที่ตัวเองเห็นได้)
-- ---------------------------------------------------------------------

create function public.dashboard() returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare v_today date := public.bkk_today(); v_month date := date_trunc('month', public.bkk_today())::date;
        v_role public.app_role := public.my_role();
begin
  if not public.is_staff() then raise exception 'ไม่มีสิทธิ์'; end if;
  return jsonb_build_object(
    'role', v_role,
    'today', v_today,
    'active_jobs', (select count(*) from public.jobs j where j.status = 'active' and v_today between j.start_date and j.end_date),
    'on_site', (select count(*) from public.attendance a where a.work_date = v_today and a.check_out is null),
    'checked_in_today', (select count(*) from public.attendance a where a.work_date = v_today),
    'pending_days_supervisor', (select count(*) from public.day_sheets d join public.teams t on t.id = d.team_id
                                where d.supervisor_approved_at is null and d.work_date < v_today
                                  and (v_role <> 'supervisor' or t.supervisor_id = auth.uid())),
    'pending_days_planner', (select count(*) from public.day_sheets d
                             where d.supervisor_approved_at is not null and d.planner_approved_at is null),
    'cost_drafts', (select count(*) from public.cost_sheets c where c.status = 'draft'),
    'cost_waiting', (select count(*) from public.cost_sheets c where c.status = 'submitted'
                     and not exists (select 1 from public.cost_sheet_approvals a
                                     where a.cost_sheet_id = c.id and a.supervisor_id = auth.uid())),
    'month_hours', (select jsonb_build_object(
                      'normal', coalesce(sum(v.normal_h) filter (where not v.holiday), 0),
                      'ot', coalesce(sum(v.ot_h) filter (where not v.holiday), 0),
                      'holiday', coalesce(sum(v.normal_h) filter (where v.holiday), 0),
                      'holiday_ot', coalesce(sum(v.ot_h) filter (where v.holiday), 0),
                      'man_days', count(*) filter (where v.check_out is not null))
                    from public.v_attendance_hours v where v.work_date >= v_month),
    'month_cost', (select jsonb_build_object('approved', coalesce(sum(c.net_total) filter (where c.status = 'approved'), 0),
                                             'submitted', coalesce(sum(c.net_total) filter (where c.status = 'submitted'), 0))
                   from public.cost_sheets c where c.submitted_at >= v_month),
    'daily', (select coalesce(jsonb_agg(x order by x.d), '[]'::jsonb) from (
                select g.d::date as d,
                       (select count(*) from public.attendance a where a.work_date = g.d::date) as people,
                       (select coalesce(sum(v.ot_h), 0) from public.v_attendance_hours v where v.work_date = g.d::date) as ot
                from generate_series(v_today - 13, v_today, interval '1 day') g(d)) x),
    'jobs', (select coalesce(jsonb_agg(x order by x.start_date desc), '[]'::jsonb) from (
               select j.id, j.job_no, j.title, j.contractor_name, j.start_date, j.end_date, j.status,
                      (select count(*) from public.workers w where w.job_id = j.id and w.active) as workers,
                      (select count(*) from public.attendance a where a.job_id = j.id and a.work_date = v_today) as today,
                      (select coalesce(sum(v.normal_h + v.ot_h), 0) from public.v_attendance_hours v where v.job_id = j.id) as hours,
                      (select coalesce(sum(c.net_total), 0) from public.cost_sheets c where c.job_id = j.id and c.status = 'approved') as approved_cost
               from public.jobs j where j.status = 'active' order by j.start_date desc limit 12) x));
end;
$$;

-- ---------------------------------------------------------------------
-- สิทธิ์: ปิดทุกอย่างจาก anon แล้วเปิดเฉพาะที่จำเป็น
-- (Supabase ให้สิทธิ์ใน public แก่ anon โดยอัตโนมัติ จึงต้อง revoke ให้ชัด)
-- ---------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from public, anon;

-- ให้สิทธิ์ผู้ล็อกอินอย่างชัดเจน (ทำงานได้แม้ปิด "expose new tables" ใน Supabase) — การเข้าถึงจริงคุมด้วย RLS
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

revoke insert, update, delete on public.day_sheets, public.cost_sheet_approvals, public.audit_log,
  public.daily_pins from authenticated;
revoke insert, delete on public.app_settings, public.profiles from authenticated;
revoke truncate, references, trigger on all tables in schema public from authenticated;

grant execute on function
  public.kiosk_team(text),
  public.kiosk_status(text, uuid, text),
  public.kiosk_clock(text, uuid, text, text)
to anon, authenticated;

revoke execute on function public.kiosk_check_pin(text, uuid, text) from authenticated;
revoke execute on function public.handle_new_user(), public.guard_profiles(), public.guard_jobs(),
  public.guard_workers(), public.guard_attendance(), public.ensure_day_sheet(), public.guard_allowances(),
  public.touch_rate(), public.guard_cost_sheets(), public.audit(), public.random_pin(), public.force_creator(),
  public.period_frozen(uuid, date) from authenticated;

-- ให้หน้าเว็บรู้ว่าต้องยืนยัน 2 ชั้นก่อนหรือไม่ (เรียกได้แม้ยังไม่ผ่าน MFA)
create function public.mfa_required() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.my_role() in ('admin', 'purchase')
     and (select s.require_mfa from public.app_settings s where s.id = 1)
     and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2';
$$;
revoke execute on function public.mfa_required() from public, anon;
grant execute on function public.mfa_required() to authenticated;

-- สร้างจ็อบ + ทีม + ลูกทีม ในครั้งเดียว (ใช้สิทธิ์ของผู้เรียก — แอดมินเท่านั้นผ่าน RLS)
-- p = {job_no, title, contractor_name, location, start_date, end_date,
--      teams: [{name, supervisor_id, members: [{full_name, position}]}]}
create function public.create_job(p jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_job uuid; v_team uuid; t jsonb; m jsonb;
begin
  if not public.has_role('admin') then raise exception 'เฉพาะแอดมิน'; end if;
  insert into public.jobs (job_no, title, contractor_name, location, start_date, end_date)
  values (btrim(p ->> 'job_no'), btrim(p ->> 'title'), nullif(btrim(p ->> 'contractor_name'), ''),
          nullif(btrim(p ->> 'location'), ''), (p ->> 'start_date')::date, (p ->> 'end_date')::date)
  returning id into v_job;
  for t in select * from jsonb_array_elements(coalesce(p -> 'teams', '[]'::jsonb)) loop
    insert into public.teams (job_id, name, supervisor_id)
    values (v_job, btrim(t ->> 'name'), nullif(t ->> 'supervisor_id', '')::uuid)
    returning id into v_team;
    for m in select * from jsonb_array_elements(coalesce(t -> 'members', '[]'::jsonb)) loop
      insert into public.workers (job_id, team_id, full_name, position)
      values (v_job, v_team, m ->> 'full_name', coalesce(nullif(btrim(m ->> 'position'), ''), 'T/C'));
    end loop;
  end loop;
  return v_job;
end;
$$;
revoke execute on function public.create_job(jsonb) from public, anon;
grant execute on function public.create_job(jsonb) to authenticated;

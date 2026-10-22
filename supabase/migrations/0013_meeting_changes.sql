-- =====================================================================
-- 0013: ปรับตามที่ประชุม
--   1) QR ลงเวลา "เข้างาน" กับ "ออกงาน" แยกกัน ใช้ได้ 1 ชั่วโมง (กันถ่ายรูป QR เก็บไว้สแกนทีหลัง)
--   2) Planner แก้เวลาได้หลังหัวหน้างานอนุมัติ (จนกว่า Planner จะอนุมัติ)
--   3) อัปโหลดลายเซ็นทีหลัง → เติมลงเอกสารที่อนุมัติไว้ตอนยังไม่มีลายเซ็น
--   5) Budget ต่อจ็อบ หักตามวันที่อนุมัติครบ (ยอดรวมก่อนหัก 3%)
--   6) Manager ใหญ่สุด: ทำได้ทุกอย่างที่แอดมินทำได้ + อนุมัติใบรายวันแทนหัวหน้างาน/Planner
--   7) นับจำนวนครั้งที่แก้เวลา (แสดงสีแดง "แก้ไขครั้งที่ N")
-- รันใน Supabase SQL Editor ต่อจาก 0012 (รันซ้ำได้)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 6) Manager = สิทธิ์แอดมินทั้งหมด
-- ---------------------------------------------------------------------
create or replace function public.has_role(variadic roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() = any(roles) or (public.my_role() = 'manager' and 'admin' = any(roles)), false)
     and public.mfa_ok();
$$;

-- ---------------------------------------------------------------------
-- 7) จำนวนครั้งที่แก้เวลา
-- ---------------------------------------------------------------------
alter table public.attendance add column if not exists edit_count int not null default 0;

create or replace view public.v_attendance_hours with (security_invoker = true) as
select a.id, a.worker_id, a.job_id, a.team_id, a.work_date, a.check_in, a.check_out,
       a.source, a.note, a.updated_by, a.updated_at,
       j.workweek, j.evening_break,
       public.is_holiday(a.work_date, j.workweek) as holiday,
       h.normal_h, h.ot_h,
       a.edit_count
from public.attendance a
join public.jobs j on j.id = a.job_id
cross join public.app_settings s
cross join lateral public.calc_hours(
  a.check_in, a.check_out, j.evening_break,
  (s.normal_hours * 60)::int, s.lunch_start, s.lunch_end,
  s.evening_break_minutes, s.round_minutes, s.grace_minutes) h
where s.id = 1;

-- ---------------------------------------------------------------------
-- 2) + 7) ล็อกการแก้เวลา:
--   ยังไม่มีใครอนุมัติ → หัวหน้าทีม/แอดมิน/Manager แก้ได้
--   หัวหน้างานอนุมัติแล้ว → Planner/แอดมิน/Manager แก้ได้
--   Planner อนุมัติแล้ว หรืออยู่ในใบคิดราคาที่ส่งแล้ว → ล็อก
-- ---------------------------------------------------------------------
create or replace function public.guard_attendance() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record; v_sheet public.day_sheets; v_staff boolean := auth.uid() is not null;
begin
  if tg_op = 'DELETE' and current_setting('app.deleting_job', true) = old.job_id::text then return old; end if;
  if current_setting('app.migrating', true) = 'on' then return coalesce(new, old); end if;
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
    if v_sheet.planner_approved_at is not null then
      raise exception 'ใบลงเวลาวันที่ % อนุมัติครบแล้ว ต้องปลดล็อกก่อนแก้ไข', to_char(r.work_date, 'DD/MM/YYYY');
    end if;
    if v_sheet.supervisor_approved_at is not null and not public.has_role('planner', 'admin') then
      raise exception 'ใบลงเวลาวันที่ % หัวหน้างานอนุมัติแล้ว — Planner เป็นผู้แก้ไขต่อ', to_char(r.work_date, 'DD/MM/YYYY');
    end if;
    if v_sheet.supervisor_approved_at is null and public.my_role() = 'planner' then
      raise exception 'รอหัวหน้างานอนุมัติใบวันที่ % ก่อน Planner จึงแก้ได้', to_char(r.work_date, 'DD/MM/YYYY');
    end if;
    if public.period_frozen(r.job_id, r.work_date) then
      raise exception 'วันที่ % อยู่ในใบคิดราคาที่ส่งแล้ว', to_char(r.work_date, 'DD/MM/YYYY');
    end if;
  end loop;

  if tg_op = 'INSERT' then
    new.edit_count := case when v_staff then 1 else 0 end;
  elsif tg_op = 'UPDATE' then
    new.edit_count := old.edit_count
      + case when v_staff and (new.check_in is distinct from old.check_in or new.check_out is distinct from old.check_out) then 1 else 0 end;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    new.updated_by := auth.uid();
    new.updated_at := now();
    if v_staff then new.source := 'supervisor'; end if;
    return new;
  end if;
  return old;
end;
$$;

-- Planner แก้/เพิ่มเวลาได้ (เงื่อนไขช่วงเวลาบังคับใน guard_attendance)
drop policy if exists attendance_insert on public.attendance;
drop policy if exists attendance_update on public.attendance;
drop policy if exists attendance_delete on public.attendance;
create policy attendance_insert on public.attendance for insert to authenticated
  with check (public.can_manage_team(team_id) or public.has_role('planner'));
create policy attendance_update on public.attendance for update to authenticated
  using (public.can_manage_team(team_id) or public.has_role('planner'))
  with check (public.can_manage_team(team_id) or public.has_role('planner'));
create policy attendance_delete on public.attendance for delete to authenticated
  using (public.can_manage_team(team_id) or public.has_role('planner'));

-- ข้อมูลเดิมที่หัวหน้าลงแทน นับเป็นแก้ไข 1 ครั้ง
do $$ begin
  perform set_config('app.migrating', 'on', true);
  update public.attendance set edit_count = 1 where source = 'supervisor' and edit_count = 0;
  perform set_config('app.migrating', 'off', true);
end $$;

-- ---------------------------------------------------------------------
-- 6) Manager อนุมัติใบรายวันแทนหัวหน้างานหรือ Planner ได้ (ทีละขั้น)
-- ---------------------------------------------------------------------
create or replace function public.approve_day(p_sheet uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.day_sheets; v_open int; v_sup uuid; me record; v_mgr boolean := public.has_role('manager');
begin
  select * into d from public.day_sheets where id = p_sheet for update;
  if not found then raise exception 'ไม่พบใบลงเวลา'; end if;
  select t.supervisor_id into v_sup from public.teams t where t.id = d.team_id;
  select count(*) into v_open from public.attendance a
    where a.team_id = d.team_id and a.work_date = d.work_date and a.check_out is null;
  if v_open > 0 then raise exception 'ยังมี % คนที่ไม่ได้ลงเวลาออก', v_open; end if;
  if d.work_date > public.bkk_today() then raise exception 'ยังไม่ถึงวันที่'; end if;
  select * into me from public.my_sign();

  if d.supervisor_approved_at is null then
    if (public.has_role('supervisor') and v_sup = auth.uid()) or v_mgr then
      update public.day_sheets set supervisor_approved_by = auth.uid(), supervisor_approved_at = now(),
        supervisor_sig_id = me.sig_id, supervisor_name = me.name,
        rejected_by = null, rejected_at = null, reject_reason = null where id = p_sheet;
    elsif public.has_role('planner') then
      raise exception 'รอหัวหน้างานอนุมัติก่อน';
    else
      raise exception 'ไม่มีสิทธิ์อนุมัติใบนี้';
    end if;
  elsif d.planner_approved_at is null then
    if public.has_role('planner') or v_mgr then
      update public.day_sheets set planner_approved_by = auth.uid(), planner_approved_at = now(),
        planner_sig_id = me.sig_id, planner_name = me.name where id = p_sheet;
    else
      raise exception 'หัวหน้างานอนุมัติแล้ว รอ Planner อนุมัติ';
    end if;
  else
    raise exception 'ใบนี้อนุมัติครบแล้ว';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 3) อัปโหลดลายเซ็น → เติมลงเอกสารที่อนุมัติไว้ตอนยังไม่มีลายเซ็น (ไม่ทับลายเซ็นเดิม)
-- ---------------------------------------------------------------------
create or replace function public.set_my_signature(p_png text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_old uuid; v_raw bytea;
begin
  if not public.is_staff() then raise exception 'ไม่มีสิทธิ์'; end if;
  select p.signature_id into v_old from public.profiles p where p.id = auth.uid();
  if p_png is not null then
    if char_length(p_png) > 200000 or p_png !~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$' then
      raise exception 'ลายเซ็นต้องเป็นรูป PNG ขนาดไม่เกิน 150KB';
    end if;
    begin
      v_raw := decode(substr(p_png, 23), 'base64');
    exception when others then
      raise exception 'ไฟล์ลายเซ็นเสีย';
    end;
    if substr(v_raw, 1, 8) <> '\x89504e470d0a1a0a'::bytea then raise exception 'ลายเซ็นต้องเป็นรูป PNG'; end if;
    if (select count(*) from public.signatures s where s.user_id = auth.uid() and s.created_at > now() - interval '1 day') >= 20 then
      raise exception 'เปลี่ยนลายเซ็นบ่อยเกินไป กรุณาลองใหม่พรุ่งนี้';
    end if;
    insert into public.signatures (user_id, png) values (auth.uid(), p_png) returning id into v_id;

    perform set_config('app.cost_rpc', 'on', true);
    update public.day_sheets set supervisor_sig_id = v_id
      where supervisor_approved_by = auth.uid() and supervisor_approved_at is not null and supervisor_sig_id is null;
    update public.day_sheets set planner_sig_id = v_id
      where planner_approved_by = auth.uid() and planner_approved_at is not null and planner_sig_id is null;
    update public.cost_sheets set submitted_sig_id = v_id
      where submitted_by = auth.uid() and status <> 'draft' and submitted_sig_id is null;
    update public.cost_sheet_approvals set sig_id = v_id where supervisor_id = auth.uid() and sig_id is null;
    perform set_config('app.cost_rpc', 'off', true);
  end if;
  update public.profiles set signature_id = v_id where id = auth.uid();
  delete from public.signatures s where s.id = v_old
    and not exists (select 1 from public.day_sheets d where d.supervisor_sig_id = s.id or d.planner_sig_id = s.id)
    and not exists (select 1 from public.cost_sheets c where c.submitted_sig_id = s.id)
    and not exists (select 1 from public.cost_sheet_approvals a where a.sig_id = s.id);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 5) Budget ต่อจ็อบ
-- ---------------------------------------------------------------------
alter table public.jobs add column if not exists budget numeric(14,2);
do $$ begin
  alter table public.jobs add constraint jobs_budget_range check (budget is null or (budget >= 0 and budget <= 999999999999));
exception when duplicate_object then null; end $$;

-- Budget ไม่นับเป็นการแก้จ็อบ (ทุกคนที่เห็นจ็อบตั้งได้ผ่าน set_job_budget)
create or replace function public.guard_jobs() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('admin')
     and (to_jsonb(new) - 'workweek' - 'evening_break' - 'terms_confirmed_by' - 'terms_confirmed_at' - 'budget')
      <> (to_jsonb(old) - 'workweek' - 'evening_break' - 'terms_confirmed_by' - 'terms_confirmed_at' - 'budget') then
    raise exception 'แก้ไขได้เฉพาะเงื่อนไขการคิดราคา';
  end if;
  if (new.workweek, new.evening_break) is distinct from (old.workweek, old.evening_break)
     or new.terms_confirmed_at is distinct from old.terms_confirmed_at
     or new.terms_confirmed_by is distinct from old.terms_confirmed_by then
    if not public.has_role('admin', 'purchase') then raise exception 'เฉพาะ Purchase หรือแอดมิน'; end if;
    new.terms_confirmed_by := auth.uid();
    new.terms_confirmed_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.set_job_budget(p_job uuid, p_budget numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_see_job(p_job) then raise exception 'ไม่มีสิทธิ์'; end if;
  if p_budget is not null and (p_budget < 0 or p_budget > 999999999999) then raise exception 'จำนวนเงินไม่ถูกต้อง'; end if;
  update public.jobs set budget = round(p_budget, 2) where id = p_job;
end;
$$;

-- ใช้ไปแล้วรายวัน = ค่าแรง (ปกติ/OT/วันหยุด) + Allowance ของวันที่อนุมัติครบ 2 ชั้น (ก่อนหัก 3%)
-- ใช้สิทธิ์ของผู้เรียก: เห็นเฉพาะจ็อบที่ตัวเองเห็นได้
create or replace function public.job_budgets(p_job uuid default null) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with ok_days as (
    select ds.job_id, ds.team_id, ds.work_date from public.day_sheets ds
    where ds.supervisor_approved_at is not null and ds.planner_approved_at is not null
      and (p_job is null or ds.job_id = p_job)
  ),
  labor as (
    select v.job_id, v.work_date,
           sum(coalesce(r.day_rate, 0) / s.normal_hours *
               case when v.holiday then v.normal_h * 2 + v.ot_h * 3 else v.normal_h + v.ot_h * 1.5 end) as amt
    from public.v_attendance_hours v
    join ok_days o on o.team_id = v.team_id and o.work_date = v.work_date
    left join public.worker_rates r on r.worker_id = v.worker_id
    cross join public.app_settings s
    where s.id = 1
    group by v.job_id, v.work_date
  ),
  allow as (
    select a.job_id, a.work_date, sum(a.amount) as amt
    from public.allowances a
    join public.workers w on w.id = a.worker_id
    join ok_days o on o.team_id = w.team_id and o.work_date = a.work_date
    group by a.job_id, a.work_date
  ),
  daily as (
    select x.job_id, x.work_date, round(sum(x.amt), 2) as amt
    from (select * from labor union all select * from allow) x
    group by x.job_id, x.work_date
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'job_id', j.id, 'job_no', j.job_no, 'title', j.title, 'status', j.status,
           'start_date', j.start_date, 'end_date', j.end_date, 'budget', j.budget,
           'spent', coalesce((select sum(d.amt) from daily d where d.job_id = j.id), 0),
           'days', coalesce((select jsonb_agg(jsonb_build_object('date', d.work_date, 'amount', d.amt) order by d.work_date)
                             from daily d where d.job_id = j.id), '[]'::jsonb))
         order by j.start_date desc), '[]'::jsonb)
  from public.jobs j
  where (p_job is null and j.status = 'active') or j.id = p_job;
$$;

-- ---------------------------------------------------------------------
-- 7) ใบคิดราคา/Time Sheet: ส่งจำนวนครั้งที่แก้ของแต่ละวันไปด้วย (แสดงสีแดง)
-- ---------------------------------------------------------------------
create or replace function public.cost_preview(p_job uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.app_settings; j public.jobs; v_workers jsonb; v_sub numeric; v_pending int; v_missing int;
begin
  if not public.can_see_job(p_job) then raise exception 'ไม่มีสิทธิ์'; end if;
  select * into s from public.app_settings where id = 1;
  select * into j from public.jobs where id = p_job;

  with d as (
    select v.worker_id, v.work_date, v.holiday, v.check_in, v.check_out, v.normal_h, v.ot_h, v.edit_count,
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
               'out', d.check_out, 'normal', d.normal_h, 'ot', d.ot_h, 'approved', d.approved, 'edits', d.edit_count) order by d.work_date) days,
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

  -- วันที่เปิดลงเวลาแต่ไม่มีใครมาทำงาน ไม่ต้องรออนุมัติ
  select count(*) into v_pending from public.day_sheets ds
  where ds.job_id = p_job and ds.work_date between p_from and p_to
    and (ds.supervisor_approved_at is null or ds.planner_approved_at is null)
    and exists (select 1 from public.attendance a where a.team_id = ds.team_id and a.work_date = ds.work_date);
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

-- ---------------------------------------------------------------------
-- 1) QR เข้างาน / ออกงาน แยกกัน ใช้ได้ 1 ชั่วโมง
--    (QR ประจำทีมแบบเดิมใช้ลงเวลาไม่ได้แล้ว)
-- ---------------------------------------------------------------------
create table if not exists public.kiosk_tokens (
  token       text primary key default encode(extensions.gen_random_bytes(24), 'hex'),
  team_id     uuid not null references public.teams(id) on delete cascade,
  kind        text not null check (kind in ('in', 'out')),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists kiosk_tokens_team_idx on public.kiosk_tokens (team_id, expires_at desc);
alter table public.kiosk_tokens enable row level security;
drop policy if exists kiosk_tokens_select on public.kiosk_tokens;
create policy kiosk_tokens_select on public.kiosk_tokens for select to authenticated using (public.can_manage_team(team_id));

create or replace function public.issue_kiosk_qr(p_team uuid, p_kind text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t record; k public.kiosk_tokens; v_today date := public.bkk_today();
begin
  if p_kind not in ('in', 'out') then raise exception 'ชนิด QR ไม่ถูกต้อง'; end if;
  if not public.can_manage_team(p_team) then raise exception 'เฉพาะหัวหน้างานของทีมนี้'; end if;
  select j.status, j.start_date, j.end_date into t from public.teams tm join public.jobs j on j.id = tm.job_id where tm.id = p_team;
  if t.status <> 'active' then raise exception 'จ็อบนี้ปิดแล้ว'; end if;
  if p_kind = 'in' and not public.day_is_open(p_team, v_today) then raise exception 'กด "เปิดลงเวลาวันนี้" ก่อน'; end if;
  if p_kind = 'out' and not exists (select 1 from public.attendance a where a.team_id = p_team and a.check_out is null
                                     and a.work_date >= v_today - 1) then
    raise exception 'ยังไม่มีใครเข้างานที่ต้องลงเวลาออก';
  end if;
  delete from public.kiosk_tokens x where x.expires_at < now() - interval '2 days';
  insert into public.kiosk_tokens (team_id, kind, expires_at) values (p_team, p_kind, now() + interval '1 hour') returning * into k;
  return jsonb_build_object('token', k.token, 'kind', k.kind, 'expires_at', k.expires_at);
end;
$$;

-- หา QR ที่ยังไม่หมดอายุ (ใช้ภายในฟังก์ชัน kiosk เท่านั้น)
create or replace function public.kiosk_token(p_token text) returns public.kiosk_tokens
language sql stable security definer set search_path = '' as $$
  select k.* from public.kiosk_tokens k where k.token = p_token and char_length(p_token) = 48 and k.expires_at > now();
$$;

create or replace function public.kiosk_team(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare k public.kiosk_tokens; t record; v_today date := public.bkk_today(); v_overnight boolean; v_in_range boolean; v_open boolean;
begin
  select * into k from public.kiosk_tokens x where x.token = p_token and char_length(p_token) = 48;
  if not found then return jsonb_build_object('ok', false, 'error', 'QR ไม่ถูกต้อง'); end if;
  if k.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'QR นี้หมดอายุแล้ว (ใช้ได้ 1 ชั่วโมง) — ขอ QR ใหม่จากหัวหน้างาน');
  end if;
  select tm.id, tm.name, j.job_no, j.title, j.status, j.start_date, j.end_date into t
  from public.teams tm join public.jobs j on j.id = tm.job_id where tm.id = k.team_id;
  if t.status <> 'active' then return jsonb_build_object('ok', false, 'error', 'จ็อบนี้ไม่ได้เปิดลงเวลาในวันนี้'); end if;
  v_overnight := exists (select 1 from public.attendance a where a.team_id = t.id and a.work_date = v_today - 1
                         and a.check_out is null and a.check_in > now() - interval '20 hours');
  v_in_range := v_today between t.start_date and t.end_date;
  v_open := v_in_range and public.day_is_open(t.id, v_today);
  if not v_open and not (v_overnight and k.kind = 'out') then
    return jsonb_build_object('ok', false, 'error',
      case when v_in_range then 'หัวหน้างานยังไม่เปิดลงเวลาวันนี้ กรุณาแจ้งหัวหน้างาน' else 'จ็อบนี้ไม่ได้เปิดลงเวลาในวันนี้' end);
  end if;
  return jsonb_build_object('ok', true, 'kind', k.kind, 'expires_at', k.expires_at,
    'job_no', t.job_no, 'job_title', t.title, 'team', t.name, 'today', v_today,
    -- QR เข้างาน: ทุกคนในทีม · QR ออกงาน: เฉพาะคนที่เข้างานแล้วยังไม่ออก
    'workers', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.full_name) order by w.full_name)
                         from public.workers w where w.team_id = t.id and w.active
                           and (case when k.kind = 'in' then v_open
                                else exists (select 1 from public.attendance a where a.worker_id = w.id and a.check_out is null
                                             and (a.work_date = v_today
                                                  or (a.work_date = v_today - 1 and a.check_in > now() - interval '20 hours'))) end)),
                        '[]'::jsonb));
end;
$$;

create or replace function public.kiosk_check_pin(p_token text, p_worker uuid, p_pin text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_date date := public.kiosk_work_date(p_worker); v_max int; p record; w record; k public.kiosk_tokens;
        v_overnight boolean := v_date < public.bkk_today();
begin
  k := public.kiosk_token(p_token);
  if k.token is null then return jsonb_build_object('ok', false, 'error', 'QR หมดอายุหรือไม่ถูกต้อง — ขอ QR ใหม่จากหัวหน้างาน'); end if;
  select x.id, x.full_name, x.team_id, x.job_id into w
  from public.workers x join public.jobs j on j.id = x.job_id
  where x.id = p_worker and x.active and x.team_id = k.team_id
    and j.status = 'active' and v_date between j.start_date and j.end_date;
  if not found then return jsonb_build_object('ok', false, 'error', 'ไม่พบชื่อในทีมนี้'); end if;
  if not public.day_is_open(w.team_id, v_date) then
    return jsonb_build_object('ok', false, 'error', 'หัวหน้างานยังไม่เปิดลงเวลาวันนี้ กรุณาแจ้งหัวหน้างาน');
  end if;
  if (select count(*) from public.kiosk_failures f where f.team_id = w.team_id and f.at > now() - interval '10 minutes') >= 30 then
    return jsonb_build_object('ok', false, 'error', 'มีการกรอกรหัสผิดจากทีมนี้หลายครั้ง กรุณารอ 10 นาทีแล้วลองใหม่');
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
    insert into public.kiosk_failures (team_id) values (w.team_id);
    delete from public.kiosk_failures f where f.at < now() - interval '1 day';
    return jsonb_build_object('ok', false, 'error',
      case when v_overnight then 'รหัสไม่ถูกต้อง (กะข้ามคืน ใช้ PIN ของเมื่อวาน)' else 'รหัสไม่ถูกต้อง' end,
      'remaining', greatest(v_max - p.failed_attempts - 1, 0));
  end if;
  return jsonb_build_object('ok', true, 'worker_id', w.id, 'name', w.full_name, 'team_id', w.team_id,
                            'job_id', w.job_id, 'today', v_date, 'overnight', v_overnight, 'kind', k.kind);
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
    'work_date', r ->> 'today', 'overnight', (r ->> 'overnight')::boolean, 'kind', r ->> 'kind');
end;
$$;

create or replace function public.kiosk_clock(p_token text, p_worker uuid, p_pin text, p_action text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r jsonb; a record; v_now timestamptz := now(); v_sheet record;
begin
  r := public.kiosk_check_pin(p_token, p_worker, p_pin);
  if not (r ->> 'ok')::boolean then return r; end if;
  if p_action is distinct from r ->> 'kind' then
    return jsonb_build_object('ok', false, 'error',
      case when r ->> 'kind' = 'in' then 'QR นี้ใช้ลงเวลาเข้างานเท่านั้น — ตอนเลิกงานให้สแกน QR ออกงาน'
           else 'QR นี้ใช้ลงเวลาออกงานเท่านั้น' end);
  end if;

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

-- ---------------------------------------------------------------------
-- สิทธิ์
-- ---------------------------------------------------------------------
revoke all on public.kiosk_tokens from anon, authenticated;
grant select on public.kiosk_tokens to authenticated;
revoke all on public.v_attendance_hours from anon;
grant select on public.v_attendance_hours to authenticated;

revoke execute on function public.has_role(public.app_role[]), public.guard_attendance(), public.approve_day(uuid),
  public.set_my_signature(text), public.guard_jobs(), public.set_job_budget(uuid, numeric), public.job_budgets(uuid),
  public.cost_preview(uuid, date, date), public.issue_kiosk_qr(uuid, text), public.kiosk_token(text),
  public.kiosk_team(text), public.kiosk_check_pin(text, uuid, text), public.kiosk_status(text, uuid, text),
  public.kiosk_clock(text, uuid, text, text) from public, anon;
revoke execute on function public.guard_attendance(), public.guard_jobs(), public.kiosk_token(text),
  public.kiosk_check_pin(text, uuid, text) from authenticated;
grant execute on function public.has_role(public.app_role[]), public.approve_day(uuid), public.set_my_signature(text),
  public.set_job_budget(uuid, numeric), public.job_budgets(uuid), public.cost_preview(uuid, date, date),
  public.issue_kiosk_qr(uuid, text) to authenticated;
grant execute on function public.kiosk_team(text), public.kiosk_status(text, uuid, text),
  public.kiosk_clock(text, uuid, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

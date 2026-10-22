-- =====================================================================
-- 0009: ปิดช่องโหว่จากการตรวจความปลอดภัยรอบ 2
--   1) ใบคิดราคาส่งได้ถึง "เมื่อวาน" เท่านั้น (ตรวจที่ฐานข้อมูล ไม่ใช่แค่หน้าเว็บ)
--   2) ลายเซ็นแยกตาราง เห็นได้เฉพาะในเอกสารที่ตัวเองมีสิทธิ์ดู
--      + บันทึกชื่อ/ลายเซ็นติดเอกสารตอนอนุมัติ (เปลี่ยนทีหลัง เอกสารเก่าไม่เปลี่ยนตาม)
--   3) PIN / แก้เวลา / เปิดลงเวลา: เฉพาะหัวหน้างานของทีมนั้น (ไม่ใช่ทุกหัวหน้าในจ็อบ)
--   4) จำกัดการกรอก PIN ผิดต่อทีม (กันสุ่ม PIN และกันแกล้งล็อกทั้งทีม)
--   5) ลบจ็อบต่อคิวกับการส่งใบคิดราคา
--   6) หน้าสแกน QR ช่วงกะข้ามคืน แสดงเฉพาะคนที่ยังค้าง
--   7) หัวหน้างานออก QR ใหม่ได้ (QR เก่าใช้ไม่ได้ทันที)
--   8) บัญชีใหม่ไม่รับชื่อที่ส่งมาเอง
--   (ฟังก์ชันใหม่ทุกตัวต้อง revoke จาก public/anon เองในไฟล์ของมัน — เหมือนไฟล์นี้)
-- รันใน Supabase SQL Editor ต่อจาก 0008 (รันซ้ำได้)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 2) ลายเซ็น: ตารางแยก เก็บแบบเพิ่มอย่างเดียว (เอกสารชี้ไปที่ลายเซ็นตอนอนุมัติ)
-- ---------------------------------------------------------------------
create table if not exists public.signatures (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  png         text not null check (char_length(png) <= 200000 and png ~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$'),
  created_at  timestamptz not null default now()
);
create index if not exists signatures_user_idx on public.signatures (user_id);
alter table public.signatures enable row level security;

alter table public.profiles add column if not exists signature_id uuid references public.signatures(id) on delete set null;

alter table public.day_sheets add column if not exists supervisor_sig_id uuid references public.signatures(id);
alter table public.day_sheets add column if not exists supervisor_name text;
alter table public.day_sheets add column if not exists planner_sig_id uuid references public.signatures(id);
alter table public.day_sheets add column if not exists planner_name text;
alter table public.cost_sheets add column if not exists submitted_sig_id uuid references public.signatures(id);
alter table public.cost_sheets add column if not exists submitted_name text;
alter table public.cost_sheet_approvals add column if not exists sig_id uuid references public.signatures(id);
alter table public.cost_sheet_approvals add column if not exists approver_name text;

do $$ begin
  alter table public.profiles add constraint profiles_full_name_len check (char_length(full_name) <= 120);
exception when duplicate_object then null; end $$;

-- ย้ายลายเซ็นเดิมจาก profiles แล้วลบคอลัมน์เก่า (เดิมพนักงานทุกคนอ่านลายเซ็นของทุกคนได้)
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'profiles' and column_name = 'signature_png') then
    insert into public.signatures (user_id, png)
    select p.id, p.signature_png from public.profiles p
    where p.signature_png ~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$' and char_length(p.signature_png) <= 200000
      and not exists (select 1 from public.signatures s where s.user_id = p.id);
    update public.profiles p set signature_id = s.id from public.signatures s
    where s.user_id = p.id and p.signature_id is null;
    alter table public.profiles drop column signature_png;
  end if;
end $$;
-- ไม่เก็บสำเนาลายเซ็นไว้ในประวัติการแก้ไข
update public.audit_log set old_data = old_data - 'signature_png', new_data = new_data - 'signature_png'
where table_name = 'profiles' and (old_data ? 'signature_png' or new_data ? 'signature_png');

-- เอกสารที่อนุมัติไปแล้ว: บันทึกชื่อ/ลายเซ็นปัจจุบันติดไว้ครั้งเดียว
do $$ begin
  perform set_config('app.cost_rpc', 'on', true);
  update public.day_sheets d set supervisor_sig_id = p.signature_id, supervisor_name = coalesce(nullif(p.full_name, ''), p.email)
  from public.profiles p where p.id = d.supervisor_approved_by and d.supervisor_approved_at is not null and d.supervisor_name is null;
  update public.day_sheets d set planner_sig_id = p.signature_id, planner_name = coalesce(nullif(p.full_name, ''), p.email)
  from public.profiles p where p.id = d.planner_approved_by and d.planner_approved_at is not null and d.planner_name is null;
  update public.cost_sheets c set submitted_sig_id = p.signature_id, submitted_name = coalesce(nullif(p.full_name, ''), p.email)
  from public.profiles p where p.id = c.submitted_by and c.status <> 'draft' and c.submitted_name is null;
  update public.cost_sheet_approvals a set sig_id = p.signature_id, approver_name = coalesce(nullif(p.full_name, ''), p.email)
  from public.profiles p where p.id = a.supervisor_id and a.approver_name is null;
  perform set_config('app.cost_rpc', 'off', true);
end $$;

-- เห็นลายเซ็นได้: ของตัวเอง หรือที่ติดอยู่ในเอกสารของจ็อบที่ตัวเองเห็นได้
drop policy if exists signatures_select on public.signatures;
create policy signatures_select on public.signatures for select to authenticated using (
  (user_id = auth.uid() and public.is_staff())
  or exists (select 1 from public.day_sheets d
             where (d.supervisor_sig_id = signatures.id or d.planner_sig_id = signatures.id) and public.can_see_job(d.job_id))
  or exists (select 1 from public.cost_sheets c where c.submitted_sig_id = signatures.id and public.can_see_job(c.job_id))
  or exists (select 1 from public.cost_sheet_approvals a join public.cost_sheets c on c.id = a.cost_sheet_id
             where a.sig_id = signatures.id and public.can_see_job(c.job_id)));

-- ชื่อ/ลายเซ็นของผู้ใช้ตอนนี้ (ใช้ตอนกดอนุมัติ)
create or replace function public.my_sign(out sig_id uuid, out name text)
language sql stable security definer set search_path = '' as $$
  select p.signature_id, coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = auth.uid();
$$;

-- ตั้ง/ลบลายเซ็นของตัวเอง (ตรวจว่าเป็นไฟล์ PNG จริง)
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
  end if;
  update public.profiles set signature_id = v_id where id = auth.uid();
  -- ลายเซ็นเก่าที่ไม่ได้ติดเอกสารใดแล้ว ลบทิ้ง (ไม่เก็บเกินจำเป็น)
  delete from public.signatures s where s.id = v_old
    and not exists (select 1 from public.day_sheets d where d.supervisor_sig_id = s.id or d.planner_sig_id = s.id)
    and not exists (select 1 from public.cost_sheets c where c.submitted_sig_id = s.id)
    and not exists (select 1 from public.cost_sheet_approvals a where a.sig_id = s.id);
  return v_id;
end;
$$;

-- โปรไฟล์: ห้ามเปลี่ยนวันที่สร้าง และห้ามชี้ไปที่ลายเซ็นของคนอื่น
create or replace function public.guard_profiles() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.id = auth.uid() and (new.role is distinct from old.role or new.active is distinct from old.active) then
    raise exception 'ไม่สามารถเปลี่ยนสิทธิ์หรือปิดบัญชีของตัวเองได้';
  end if;
  if new.signature_id is distinct from old.signature_id and new.signature_id is not null
     and not exists (select 1 from public.signatures s where s.id = new.signature_id and s.user_id = new.id) then
    raise exception 'ใช้ลายเซ็นของคนอื่นไม่ได้';
  end if;
  new.email := old.email;
  new.created_at := old.created_at;
  new.full_name := btrim(regexp_replace(new.full_name, '\s+', ' ', 'g'));
  return new;
end;
$$;

-- ---------- อนุมัติ: บันทึกชื่อ/ลายเซ็นติดเอกสาร ----------
create or replace function public.approve_day(p_sheet uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.day_sheets; v_open int; v_sup uuid; me record;
begin
  select * into d from public.day_sheets where id = p_sheet for update;
  if not found then raise exception 'ไม่พบใบลงเวลา'; end if;
  select t.supervisor_id into v_sup from public.teams t where t.id = d.team_id;
  select count(*) into v_open from public.attendance a
    where a.team_id = d.team_id and a.work_date = d.work_date and a.check_out is null;
  if v_open > 0 then raise exception 'ยังมี % คนที่ไม่ได้ลงเวลาออก', v_open; end if;
  if d.work_date > public.bkk_today() then raise exception 'ยังไม่ถึงวันที่'; end if;
  select * into me from public.my_sign();

  if public.has_role('supervisor') and v_sup = auth.uid() then
    update public.day_sheets set supervisor_approved_by = auth.uid(), supervisor_approved_at = now(),
      supervisor_sig_id = me.sig_id, supervisor_name = me.name,
      rejected_by = null, rejected_at = null, reject_reason = null where id = p_sheet;
  elsif public.has_role('planner') then
    if d.supervisor_approved_at is null then raise exception 'รอหัวหน้างานอนุมัติก่อน'; end if;
    update public.day_sheets set planner_approved_by = auth.uid(), planner_approved_at = now(),
      planner_sig_id = me.sig_id, planner_name = me.name where id = p_sheet;
  else
    raise exception 'ไม่มีสิทธิ์อนุมัติใบนี้';
  end if;
end;
$$;

create or replace function public.unapprove_day(p_sheet uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.day_sheets; v_sup uuid;
begin
  select * into d from public.day_sheets where id = p_sheet for update;
  if not found then raise exception 'ไม่พบใบลงเวลา'; end if;
  if public.period_frozen(d.job_id, d.work_date) then raise exception 'วันนี้อยู่ในใบคิดราคาที่ส่งแล้ว'; end if;
  select t.supervisor_id into v_sup from public.teams t where t.id = d.team_id;

  if public.has_role('admin') then
    update public.day_sheets set supervisor_approved_by = null, supervisor_approved_at = null, supervisor_sig_id = null, supervisor_name = null,
      planner_approved_by = null, planner_approved_at = null, planner_sig_id = null, planner_name = null where id = p_sheet;
  elsif public.has_role('planner') and d.planner_approved_at is not null then
    update public.day_sheets set planner_approved_by = null, planner_approved_at = null, planner_sig_id = null, planner_name = null
    where id = p_sheet;
  elsif public.has_role('supervisor') and v_sup = auth.uid() and d.planner_approved_at is null then
    update public.day_sheets set supervisor_approved_by = null, supervisor_approved_at = null, supervisor_sig_id = null, supervisor_name = null
    where id = p_sheet;
  else
    raise exception 'ยกเลิกไม่ได้ (planner อนุมัติแล้ว ต้องให้ planner หรือแอดมินยกเลิก)';
  end if;
end;
$$;

create or replace function public.reject_day(p_sheet uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.day_sheets;
begin
  if not public.has_role('planner', 'admin') then raise exception 'ไม่มีสิทธิ์'; end if;
  if char_length(coalesce(btrim(p_reason), '')) < 3 then raise exception 'กรุณาระบุเหตุผล'; end if;
  select * into d from public.day_sheets where id = p_sheet for update;
  if not found then raise exception 'ไม่พบใบลงเวลา'; end if;
  if public.period_frozen(d.job_id, d.work_date) then raise exception 'วันนี้อยู่ในใบคิดราคาที่ส่งแล้ว'; end if;
  update public.day_sheets set supervisor_approved_by = null, supervisor_approved_at = null, supervisor_sig_id = null, supervisor_name = null,
    planner_approved_by = null, planner_approved_at = null, planner_sig_id = null, planner_name = null,
    rejected_by = auth.uid(), rejected_at = now(), reject_reason = left(btrim(p_reason), 500)
  where id = p_sheet;
end;
$$;

create or replace function public.approve_cost_sheet(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.cost_sheets; v_need int; v_have int; me record;
begin
  select * into c from public.cost_sheets where id = p_id for update;
  if not found or c.status <> 'submitted' then raise exception 'ใบนี้ไม่ได้รออนุมัติ'; end if;
  if not public.is_job_supervisor(c.job_id) then raise exception 'เฉพาะหัวหน้างานของจ็อบนี้'; end if;
  select * into me from public.my_sign();
  insert into public.cost_sheet_approvals (cost_sheet_id, supervisor_id, sig_id, approver_name)
  values (p_id, auth.uid(), me.sig_id, me.name)
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

-- ---------------------------------------------------------------------
-- 1) ส่งใบคิดราคา: ถึงเมื่อวานเท่านั้น (วันนี้/อนาคตยังทำงานอยู่ ห้ามล็อก)
-- ---------------------------------------------------------------------
create or replace function public.submit_cost_sheet(p_id uuid, p_cut_to date default null) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cost_sheets; v jsonb; v_cut date; v_rest_from date; v_rest_to date; me record;
begin
  if not public.has_role('purchase', 'admin') then raise exception 'ไม่มีสิทธิ์'; end if;
  select * into c from public.cost_sheets where id = p_id;
  if not found then raise exception 'ไม่พบใบคิดราคา'; end if;
  perform pg_advisory_xact_lock(hashtext('cost:' || c.job_id::text));
  select * into c from public.cost_sheets where id = p_id for update;
  if c.status <> 'draft' then raise exception 'ใบนี้ไม่อยู่ในสถานะร่าง'; end if;
  if not exists (select 1 from public.jobs j where j.id = c.job_id and j.terms_confirmed_at is not null) then
    raise exception 'Purchase ต้องยืนยันเงื่อนไขคิดราคา (5/6 วัน และพักเย็น) ก่อนส่ง';
  end if;
  if p_cut_to is not null and p_cut_to < c.period_from then raise exception 'วันที่ส่งถึงต้องอยู่ในช่วงของใบนี้'; end if;
  v_cut := least(coalesce(p_cut_to, c.period_to), c.period_to, public.bkk_today() - 1);
  if v_cut < c.period_from then raise exception 'ส่งได้ถึงเมื่อวานเท่านั้น — ใบนี้ยังไม่มีวันที่ส่งได้'; end if;
  if v_cut < c.period_to then
    v_rest_from := v_cut + 1;
    v_rest_to := c.period_to;
    c.period_to := v_cut;
  end if;
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
  select * into me from public.my_sign();

  perform set_config('app.cost_rpc', 'on', true);
  delete from public.cost_sheet_approvals where cost_sheet_id = p_id;
  update public.cost_sheets set status = 'submitted', revision = revision + 1, snapshot = v, period_to = c.period_to,
    subtotal = (v ->> 'subtotal')::numeric, wht_amount = (v ->> 'wht')::numeric, net_total = (v ->> 'net')::numeric,
    submitted_by = auth.uid(), submitted_at = now(), submitted_sig_id = me.sig_id, submitted_name = me.name,
    reject_reason = null, rejected_by = null, rejected_at = null
  where id = p_id;
  perform set_config('app.cost_rpc', 'off', true);
  if v_rest_from is not null and not exists (
       select 1 from public.cost_sheets o where o.job_id = c.job_id and o.id <> c.id
       and daterange(o.period_from, o.period_to, '[]') && daterange(v_rest_from, v_rest_to, '[]')) then
    insert into public.cost_sheets (job_id, period_from, period_to) values (c.job_id, v_rest_from, v_rest_to);
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 3) สิทธิ์ระดับทีม: PIN / แก้เวลา / เปิดลงเวลา เฉพาะหัวหน้างานของทีมนั้น (หรือแอดมิน)
-- ---------------------------------------------------------------------
create or replace function public.can_manage_team(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role('admin')
      or (public.has_role('supervisor') and exists (select 1 from public.teams t where t.id = p_team and t.supervisor_id = auth.uid()));
$$;

drop policy if exists pins_select on public.daily_pins;
create policy pins_select on public.daily_pins for select to authenticated
  using (exists (select 1 from public.workers w where w.id = worker_id and public.can_manage_team(w.team_id)));

drop policy if exists attendance_insert on public.attendance;
drop policy if exists attendance_update on public.attendance;
drop policy if exists attendance_delete on public.attendance;
create policy attendance_insert on public.attendance for insert to authenticated
  with check (public.can_manage_team(team_id));
create policy attendance_update on public.attendance for update to authenticated
  using (public.can_manage_team(team_id)) with check (public.can_manage_team(team_id));
create policy attendance_delete on public.attendance for delete to authenticated
  using (public.can_manage_team(team_id));

create or replace function public.generate_pins(p_team uuid, p_worker uuid default null)
returns int
language plpgsql security definer set search_path = '' as $$
declare v_today date := public.bkk_today(); w record; v_pin text; n int := 0;
begin
  if not public.can_manage_team(p_team) then raise exception 'เฉพาะหัวหน้างานของทีมนี้'; end if;

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

-- ใบที่เกิดจากการลงเวลาโดยหัวหน้าของทีมนั้นเท่านั้นที่นับว่า "เปิดแล้ว"
create or replace function public.ensure_day_sheet() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_mine boolean := auth.uid() is not null and public.can_manage_team(new.team_id);
begin
  insert into public.day_sheets (job_id, team_id, work_date, opened_by, opened_at)
  values (new.job_id, new.team_id, new.work_date,
          case when v_mine then auth.uid() end, case when v_mine then now() end)
  on conflict (team_id, work_date) do nothing;
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- 4) กรอก PIN ผิดเกิน 30 ครั้งใน 10 นาทีต่อทีม → พักทั้งทีม 10 นาที
-- ---------------------------------------------------------------------
create table if not exists public.kiosk_failures (
  team_id  uuid not null references public.teams(id) on delete cascade,
  at       timestamptz not null default now()
);
create index if not exists kiosk_failures_team_idx on public.kiosk_failures (team_id, at);
alter table public.kiosk_failures enable row level security;

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
                            'job_id', w.job_id, 'today', v_date, 'overnight', v_overnight);
end;
$$;

-- ---------------------------------------------------------------------
-- 6) สแกน QR: ถ้าวันนี้ยังไม่เปิด แต่มีกะข้ามคืนค้าง → แสดงเฉพาะคนที่ค้าง
-- ---------------------------------------------------------------------
create or replace function public.kiosk_team(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t record; v_today date := public.bkk_today(); v_overnight boolean; v_in_range boolean; v_open boolean;
begin
  select tm.id, tm.name, j.job_no, j.title, j.status, j.start_date, j.end_date into t
  from public.teams tm join public.jobs j on j.id = tm.job_id
  where tm.qr_token = p_token and char_length(p_token) = 48;
  if not found then return jsonb_build_object('ok', false, 'error', 'QR ไม่ถูกต้อง'); end if;
  if t.status <> 'active' then return jsonb_build_object('ok', false, 'error', 'จ็อบนี้ไม่ได้เปิดลงเวลาในวันนี้'); end if;
  v_overnight := exists (select 1 from public.attendance a where a.team_id = t.id and a.work_date = v_today - 1
                         and a.check_out is null and a.check_in > now() - interval '20 hours');
  v_in_range := v_today between t.start_date and t.end_date;
  v_open := v_in_range and public.day_is_open(t.id, v_today);
  if not v_open and not v_overnight then
    return jsonb_build_object('ok', false, 'error',
      case when v_in_range then 'หัวหน้างานยังไม่เปิดลงเวลาวันนี้ กรุณาแจ้งหัวหน้างาน' else 'จ็อบนี้ไม่ได้เปิดลงเวลาในวันนี้' end);
  end if;
  return jsonb_build_object('ok', true, 'job_no', t.job_no, 'job_title', t.title, 'team', t.name,
    'today', v_today,
    'workers', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.full_name) order by w.full_name)
                         from public.workers w where w.team_id = t.id and w.active
                           and (v_open or exists (select 1 from public.attendance a where a.worker_id = w.id
                                                  and a.work_date = v_today - 1 and a.check_out is null
                                                  and a.check_in > now() - interval '20 hours'))), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------
-- 5) ลบจ็อบ: รอคิวเดียวกับการส่งใบคิดราคา (กันลบใบที่เพิ่งถูกส่งพร้อมกัน)
-- ---------------------------------------------------------------------
create or replace function public.delete_job(p_job uuid, p_confirm text) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  if not public.has_role('admin') then raise exception 'เฉพาะแอดมิน'; end if;
  perform pg_advisory_xact_lock(hashtext('cost:' || p_job::text));
  select * into j from public.jobs where id = p_job for update;
  if not found then raise exception 'ไม่พบจ็อบ'; end if;
  if btrim(coalesce(p_confirm, '')) <> j.job_no then raise exception 'เลขจ็อบที่พิมพ์ยืนยันไม่ตรง'; end if;
  if exists (select 1 from public.cost_sheets c where c.job_id = p_job and c.status in ('submitted', 'approved')) then
    raise exception 'จ็อบนี้มีใบคิดราคาที่ส่งหรืออนุมัติแล้ว ลบไม่ได้ (เป็นเอกสารการเงิน) — ใช้ "ปิดจ็อบ" แทน';
  end if;
  perform set_config('app.deleting_job', p_job::text, true);
  delete from public.jobs where id = p_job;  -- ลบทีม รายชื่อ เวลา ใบรายวัน allowance ใบร่าง ตามกันไป
  perform set_config('app.deleting_job', '', true);
end;
$$;

-- ---------------------------------------------------------------------
-- 7) ออก QR ใหม่ (QR เก่าใช้ไม่ได้ทันที) — กรณี QR หลุดไปนอกทีม
-- ---------------------------------------------------------------------
create or replace function public.rotate_team_qr(p_team uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_team(p_team) then raise exception 'เฉพาะหัวหน้างานของทีมนี้'; end if;
  update public.teams set qr_token = encode(extensions.gen_random_bytes(24), 'hex') where id = p_team;
end;
$$;

-- 8) บัญชีใหม่ไม่รับชื่อที่ส่งมาตอนสมัคร (กันตั้งชื่อปลอมเป็นพนักงานจริง) — แอดมินตั้งชื่อเอง
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, '')
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------- view ใบรายวัน: รวมคอลัมน์ชื่อ/ลายเซ็นที่เพิ่ม ----------
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

-- ---------------------------------------------------------------------
-- สิทธิ์
-- ---------------------------------------------------------------------
revoke all on public.signatures, public.kiosk_failures from anon, authenticated;
grant select on public.signatures to authenticated;
revoke all on public.v_day_sheets from anon;
revoke all on public.v_day_sheets from authenticated;
grant select on public.v_day_sheets to authenticated;

revoke execute on function public.my_sign(), public.can_manage_team(uuid), public.set_my_signature(text),
  public.generate_pins(uuid, uuid), public.ensure_day_sheet(), public.guard_profiles(),
  public.kiosk_check_pin(text, uuid, text), public.kiosk_team(text), public.delete_job(uuid, text),
  public.approve_day(uuid), public.unapprove_day(uuid), public.reject_day(uuid, text),
  public.approve_cost_sheet(uuid), public.submit_cost_sheet(uuid, date), public.rotate_team_qr(uuid),
  public.handle_new_user() from public, anon;
revoke execute on function public.my_sign(), public.ensure_day_sheet(),
  public.guard_profiles(), public.kiosk_check_pin(text, uuid, text), public.handle_new_user() from authenticated;
-- can_manage_team ใช้ในเงื่อนไข RLS จึงต้องเรียกได้ (คืนแค่ true/false ของตัวเอง)
grant execute on function public.can_manage_team(uuid) to authenticated;
grant execute on function public.set_my_signature(text), public.generate_pins(uuid, uuid), public.delete_job(uuid, text),
  public.rotate_team_qr(uuid),
  public.approve_day(uuid), public.unapprove_day(uuid), public.reject_day(uuid, text),
  public.approve_cost_sheet(uuid), public.submit_cost_sheet(uuid, date) to authenticated;
grant execute on function public.kiosk_team(text) to anon, authenticated;

notify pgrst, 'reload schema';

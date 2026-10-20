-- =====================================================================
-- 0003: ยืนยันเงื่อนไขคิดราคา + บังคับหัวหน้างานทุกทีม
-- รันใน Supabase SQL Editor ต่อจาก 0001 และ 0002 (รันซ้ำได้)
-- =====================================================================

-- ---------- 1) เงื่อนไขคิดราคาต้องมีคนยืนยัน ----------
alter table public.jobs add column if not exists terms_confirmed_by uuid references public.profiles(id);
alter table public.jobs add column if not exists terms_confirmed_at timestamptz;

-- purchase แก้ได้เฉพาะเงื่อนไข · เมื่อเงื่อนไขเปลี่ยนหรือกดยืนยัน ระบบบันทึกผู้ยืนยันเอง (ปลอมไม่ได้)
create or replace function public.guard_jobs() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('admin')
     and (to_jsonb(new) - 'workweek' - 'evening_break' - 'terms_confirmed_by' - 'terms_confirmed_at')
      <> (to_jsonb(old) - 'workweek' - 'evening_break' - 'terms_confirmed_by' - 'terms_confirmed_at') then
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

create or replace function public.force_creator() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.created_by := auth.uid();
  if tg_table_name = 'jobs' then
    new.terms_confirmed_by := null; new.terms_confirmed_at := null;
  end if;
  if tg_table_name = 'cost_sheets' then
    new.status := 'draft'; new.revision := 0; new.snapshot := null;
    new.subtotal := null; new.wht_amount := null; new.net_total := null;
    new.submitted_by := null; new.submitted_at := null; new.approved_at := null;
    new.reject_reason := null; new.rejected_by := null; new.rejected_at := null;
  end if;
  return new;
end;
$$;

create or replace function public.submit_cost_sheet(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cost_sheets; v jsonb;
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

-- ---------- 2) ทุกทีมต้องมีหัวหน้างาน (คนนี้คือผู้อนุมัติใบลงเวลา) ----------
create or replace function public.guard_teams() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.supervisor_id is null then
    raise exception 'กรุณาเลือกหัวหน้างานของ % (คนนี้เป็นผู้อนุมัติใบลงเวลา)', new.name;
  end if;
  if (tg_op = 'INSERT' or new.supervisor_id is distinct from old.supervisor_id)
     and not exists (select 1 from public.profiles p where p.id = new.supervisor_id and p.role = 'supervisor' and p.active) then
    raise exception 'ผู้ที่เลือกไม่ได้อยู่ในตำแหน่งหัวหน้างาน';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_teams on public.teams;
create trigger guard_teams before insert or update on public.teams
  for each row execute function public.guard_teams();

revoke execute on function public.guard_teams() from public, anon, authenticated;

-- ให้ Data API รู้จักคอลัมน์ใหม่ทันที
notify pgrst, 'reload schema';

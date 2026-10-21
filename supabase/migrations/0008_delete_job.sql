-- =====================================================================
-- 0008: ลบจ็อบ (แอดมิน) — ลบไม่ได้ถ้ามีใบคิดราคาที่ส่ง/อนุมัติแล้ว
-- รันใน Supabase SQL Editor ต่อจาก 0007 (รันซ้ำได้)
-- =====================================================================

create or replace function public.delete_job(p_job uuid, p_confirm text) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  if not public.has_role('admin') then raise exception 'เฉพาะแอดมิน'; end if;
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

create or replace function public.guard_attendance() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record; v_sheet public.day_sheets;
begin
  -- แอดมินลบทั้งจ็อบผ่าน delete_job (ตรวจสิทธิ์และใบคิดราคาแล้ว) — ข้ามการล็อกรายวัน
  if tg_op = 'DELETE' and current_setting('app.deleting_job', true) = old.job_id::text then return old; end if;
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

create or replace function public.guard_allowances() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  -- แอดมินลบทั้งจ็อบผ่าน delete_job (ตรวจสิทธิ์และใบคิดราคาแล้ว) — ข้ามการล็อกรายวัน
  if tg_op = 'DELETE' and current_setting('app.deleting_job', true) = old.job_id::text then return old; end if;
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

-- ลบจ็อบได้ทางเดียวคือผ่าน delete_job (มีการตรวจใบคิดราคา)
drop policy if exists jobs_delete on public.jobs;
revoke delete on public.jobs from authenticated;

revoke execute on function public.delete_job(uuid, text) from public, anon;
grant execute on function public.delete_job(uuid, text) to authenticated;
revoke execute on function public.guard_attendance(), public.guard_allowances() from public, anon, authenticated;

notify pgrst, 'reload schema';

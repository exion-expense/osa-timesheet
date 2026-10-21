-- =====================================================================
-- 0004: วันที่อนุมัติครบ (หัวหน้างาน + Planner) ไหลเข้าใบคิดราคา (ร่าง) ของจ็อบอัตโนมัติ
-- รันใน Supabase SQL Editor ต่อจาก 0003 (รันซ้ำได้)
-- =====================================================================

-- ใส่วันที่ลงใบคิดราคาร่างล่าสุดของจ็อบ (ขยายช่วงวันที่) — ถ้าไม่มีหรือขยายแล้วจะซ้อนใบอื่น ให้สร้างใบร่างใหม่
create or replace function public.attach_day_to_cost(p_job uuid, p_date date) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.cost_sheets; v_from date; v_to date;
begin
  perform pg_advisory_xact_lock(hashtext('cost:' || p_job::text));
  if exists (select 1 from public.cost_sheets c where c.job_id = p_job and p_date between c.period_from and c.period_to) then
    return;  -- อยู่ในใบใดใบหนึ่งแล้ว
  end if;
  select * into d from public.cost_sheets c where c.job_id = p_job and c.status = 'draft'
  order by c.created_at desc limit 1;
  if found then
    v_from := least(d.period_from, p_date);
    v_to := greatest(d.period_to, p_date);
    if not exists (select 1 from public.cost_sheets o where o.job_id = p_job and o.id <> d.id
                   and daterange(o.period_from, o.period_to, '[]') && daterange(v_from, v_to, '[]')) then
      update public.cost_sheets set period_from = v_from, period_to = v_to where id = d.id;
      return;
    end if;
  end if;
  insert into public.cost_sheets (job_id, period_from, period_to) values (p_job, p_date, p_date);
end;
$$;

create or replace function public.on_day_approved() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.supervisor_approved_at is not null and new.planner_approved_at is not null
     and (old.supervisor_approved_at is null or old.planner_approved_at is null) then
    perform public.attach_day_to_cost(new.job_id, new.work_date);
  end if;
  return null;
end;
$$;
drop trigger if exists on_day_approved on public.day_sheets;
create trigger on_day_approved after update on public.day_sheets
  for each row execute function public.on_day_approved();

revoke execute on function public.attach_day_to_cost(uuid, date), public.on_day_approved() from public, anon, authenticated;

-- ดึงวันที่อนุมัติครบไปแล้วก่อนหน้านี้เข้าใบคิดราคาด้วย
do $$
declare r record;
begin
  for r in select d.job_id, d.work_date from public.day_sheets d
           where d.supervisor_approved_at is not null and d.planner_approved_at is not null
           order by d.job_id, d.work_date loop
    perform public.attach_day_to_cost(r.job_id, r.work_date);
  end loop;
end $$;

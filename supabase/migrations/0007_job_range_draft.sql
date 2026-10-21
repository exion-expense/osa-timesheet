-- =====================================================================
-- 0007: ใบคิดราคาครอบทั้งช่วงจ็อบตั้งแต่สร้างจ็อบ (วันที่ยังไม่มีข้อมูลเป็นช่องว่าง)
--       + Purchase ส่งก่อนจ็อบจบได้ โดยเลือก "ส่งถึงวันที่" วันที่เหลือย้ายไปใบร่างใหม่
-- รันใน Supabase SQL Editor ต่อจาก 0006 (รันซ้ำได้)
-- =====================================================================

-- ให้จ็อบที่เปิดอยู่มีใบร่างครอบช่วงที่ยังไม่ถูกส่งคิดราคา
create or replace function public.ensure_job_draft(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; d public.cost_sheets; v_from date; v_to date; f date; t date;
begin
  select * into j from public.jobs where id = p_job;
  if not found or j.status <> 'active' then return; end if;
  perform pg_advisory_xact_lock(hashtext('cost:' || p_job::text));
  -- เริ่มต่อจากใบที่ส่งแล้วใบล่าสุด
  v_from := greatest(j.start_date, coalesce((select max(c.period_to) + 1 from public.cost_sheets c
                                             where c.job_id = p_job and c.status <> 'draft'), j.start_date));
  v_to := j.end_date;
  if v_from > v_to then return; end if;
  select * into d from public.cost_sheets c where c.job_id = p_job and c.status = 'draft' order by c.created_at desc limit 1;
  if found then
    f := least(d.period_from, v_from);
    -- ไม่ยืดเกินวันสิ้นสุดจ็อบ เว้นแต่มีข้อมูลลงเวลาเลยไปแล้ว
    t := greatest(v_to, coalesce((select max(x.work_date) from public.day_sheets x where x.job_id = p_job and x.work_date >= v_from), v_to));
    if exists (select 1 from public.cost_sheets o where o.job_id = p_job and o.id <> d.id
               and daterange(o.period_from, o.period_to, '[]') && daterange(f, t, '[]')) then
      f := greatest(d.period_from, v_from);
      t := greatest(d.period_to, v_to);
    end if;
    if (f, t) is distinct from (d.period_from, d.period_to)
       and not exists (select 1 from public.cost_sheets o where o.job_id = p_job and o.id <> d.id
                       and daterange(o.period_from, o.period_to, '[]') && daterange(f, t, '[]')) then
      update public.cost_sheets set period_from = f, period_to = t where id = d.id;
    end if;
  elsif not exists (select 1 from public.cost_sheets o where o.job_id = p_job
                    and daterange(o.period_from, o.period_to, '[]') && daterange(v_from, v_to, '[]')) then
    insert into public.cost_sheets (job_id, period_from, period_to) values (p_job, v_from, v_to);
  end if;
end;
$$;

create or replace function public.on_job_dates() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.ensure_job_draft(new.id);
  return null;
end;
$$;
drop trigger if exists on_job_dates on public.jobs;
create trigger on_job_dates after insert or update of start_date, end_date, status on public.jobs
  for each row execute function public.on_job_dates();

-- ส่งใบคิดราคา: p_cut_to = ส่งถึงวันที่ (ไม่ใส่ = ส่งทั้งช่วง) วันที่เหลือย้ายไปใบร่างใหม่
drop function if exists public.submit_cost_sheet(uuid);
create or replace function public.submit_cost_sheet(p_id uuid, p_cut_to date default null) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cost_sheets; v jsonb; v_rest_from date; v_rest_to date;
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
  if p_cut_to is not null and p_cut_to < c.period_to then
    if p_cut_to < c.period_from then raise exception 'วันที่ส่งถึงต้องอยู่ในช่วงของใบนี้'; end if;
    v_rest_from := p_cut_to + 1;
    v_rest_to := c.period_to;
    c.period_to := p_cut_to;
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
  update public.cost_sheets set status = 'submitted', revision = revision + 1, snapshot = v, period_to = c.period_to,
    subtotal = (v ->> 'subtotal')::numeric, wht_amount = (v ->> 'wht')::numeric, net_total = (v ->> 'net')::numeric,
    submitted_by = auth.uid(), submitted_at = now(), reject_reason = null, rejected_by = null, rejected_at = null
  where id = p_id;
  perform set_config('app.cost_rpc', 'off', true);
  if v_rest_from is not null then
    insert into public.cost_sheets (job_id, period_from, period_to) values (c.job_id, v_rest_from, v_rest_to);
  end if;
end;
$$;

-- ป้าย "คิดราคา" นับเฉพาะใบร่างที่มีวันที่อนุมัติครบแล้ว
create or replace function public.dashboard() returns jsonb
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
    -- ใบร่างที่มีวันที่อนุมัติครบแล้วอย่างน้อย 1 วัน (พร้อมให้ Purchase คิดราคา)
    'cost_drafts', (select count(*) from public.cost_sheets c where c.status = 'draft'
                    and exists (select 1 from public.day_sheets d where d.job_id = c.job_id
                                and d.work_date between c.period_from and c.period_to
                                and d.supervisor_approved_at is not null and d.planner_approved_at is not null)),
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


revoke execute on function public.ensure_job_draft(uuid), public.on_job_dates() from public, anon, authenticated;
revoke execute on function public.submit_cost_sheet(uuid, date) from public, anon;
grant execute on function public.submit_cost_sheet(uuid, date) to authenticated;

-- จ็อบที่เปิดอยู่ตอนนี้: สร้าง/ขยายใบร่างให้ครอบทั้งช่วง
do $$
declare r record;
begin
  for r in select id from public.jobs where status = 'active' loop
    perform public.ensure_job_draft(r.id);
  end loop;
end $$;

notify pgrst, 'reload schema';

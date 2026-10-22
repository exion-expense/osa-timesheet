-- =====================================================================
-- 0010: วันที่เปิดลงเวลาแต่ไม่มีใครมาทำงาน (ใบว่าง) ไม่ต้องรออนุมัติ
--       ไม่ขวางการส่งใบคิดราคา และไม่นับเป็นงานค้าง
-- รันใน Supabase SQL Editor ต่อจาก 0009 (รันซ้ำได้)
-- =====================================================================

create or replace function public.cost_preview(p_job uuid, p_from date, p_to date) returns jsonb
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
                                  and (v_role <> 'supervisor' or t.supervisor_id = auth.uid())
                                  and exists (select 1 from public.attendance a where a.team_id = d.team_id and a.work_date = d.work_date)),
    'pending_days_planner', (select count(*) from public.day_sheets d
                             where d.supervisor_approved_at is not null and d.planner_approved_at is null
                               and exists (select 1 from public.attendance a where a.team_id = d.team_id and a.work_date = d.work_date)),
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

revoke execute on function public.cost_preview(uuid, date, date), public.dashboard() from public, anon;
grant execute on function public.cost_preview(uuid, date, date), public.dashboard() to authenticated;

notify pgrst, 'reload schema';

-- =====================================================================
-- 0012: Manager อนุมัติใบคิดราคา (แทนหัวหน้างาน)
--   * Purchase ส่ง → Manager คนใดคนหนึ่งกดอนุมัติ → จบ (หรือตีกลับพร้อมเหตุผล)
--   * Manager ดูได้ทุกจ็อบและประวัติการแก้ไขเหมือนแอดมิน แต่แก้ข้อมูลไม่ได้
--   * หัวหน้างานยังอนุมัติใบลงเวลารายวันเหมือนเดิม แต่ไม่ต้องอนุมัติราคาแล้ว
-- รันใน Supabase SQL Editor ต่อจาก 0011 (รันซ้ำได้)
-- =====================================================================

-- ดูได้ทุกจ็อบ
create or replace function public.can_see_job(p_job uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role('admin', 'planner', 'purchase', 'manager') or public.is_job_supervisor(p_job);
$$;

-- ถ้าเปิดรหัส 2 ชั้น Manager ต้องใช้ด้วย (อนุมัติเงิน)
create or replace function public.mfa_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when public.my_role() in ('admin', 'purchase', 'manager')
         and (select s.require_mfa from public.app_settings s where s.id = 1)
      then coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    else true end;
$$;

create or replace function public.mfa_required() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.my_role() in ('admin', 'purchase', 'manager')
     and (select s.require_mfa from public.app_settings s where s.id = 1)
     and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2';
$$;

-- ประวัติการแก้ไข: แอดมินและ Manager อ่านได้
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated using (public.has_role('admin', 'manager'));

-- อนุมัติราคา: Manager คนเดียวพอ (บันทึกชื่อ/ลายเซ็นติดเอกสาร)
create or replace function public.approve_cost_sheet(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.cost_sheets; me record;
begin
  select * into c from public.cost_sheets where id = p_id for update;
  if not found or c.status <> 'submitted' then raise exception 'ใบนี้ไม่ได้รออนุมัติ'; end if;
  if not public.has_role('manager') then raise exception 'เฉพาะ Manager อนุมัติราคาได้'; end if;
  select * into me from public.my_sign();
  insert into public.cost_sheet_approvals (cost_sheet_id, supervisor_id, sig_id, approver_name)
  values (p_id, auth.uid(), me.sig_id, me.name)
    on conflict do nothing;
  perform set_config('app.cost_rpc', 'on', true);
  update public.cost_sheets set status = 'approved', approved_at = now() where id = p_id;
  perform set_config('app.cost_rpc', 'off', true);
  return 'approved';
end;
$$;

-- ตีกลับ: Manager หรือแอดมิน
create or replace function public.reject_cost_sheet(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cost_sheets;
begin
  select * into c from public.cost_sheets where id = p_id for update;
  if not found or c.status <> 'submitted' then raise exception 'ใบนี้ไม่ได้รออนุมัติ'; end if;
  if not public.has_role('manager', 'admin') then raise exception 'เฉพาะ Manager'; end if;
  if char_length(coalesce(btrim(p_reason), '')) < 3 then raise exception 'กรุณาระบุเหตุผล'; end if;
  perform set_config('app.cost_rpc', 'on', true);
  delete from public.cost_sheet_approvals where cost_sheet_id = p_id;
  update public.cost_sheets set status = 'draft', reject_reason = left(btrim(p_reason), 500),
    rejected_by = auth.uid(), rejected_at = now() where id = p_id;
  perform set_config('app.cost_rpc', 'off', true);
end;
$$;

revoke execute on function public.approve_cost_sheet(uuid), public.reject_cost_sheet(uuid, text),
  public.can_see_job(uuid), public.mfa_ok(), public.mfa_required() from public, anon;
grant execute on function public.approve_cost_sheet(uuid), public.reject_cost_sheet(uuid, text),
  public.can_see_job(uuid), public.mfa_ok(), public.mfa_required() to authenticated;

notify pgrst, 'reload schema';

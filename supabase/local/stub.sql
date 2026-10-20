-- ใช้ทดสอบบนเครื่องเท่านั้น: จำลองสิ่งที่ Supabase มีให้ (roles, auth schema, extensions)
-- ห้ามรันไฟล์นี้บน Supabase จริง

create extension if not exists pgcrypto;
create schema if not exists extensions;
alter extension pgcrypto set schema extensions;

do $$ begin
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;
  create role authenticator noinherit login password 'authenticator';
exception when duplicate_object then null; end $$;
grant anon, authenticated, service_role to authenticator;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  encrypted_password text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;
create or replace function auth.role() returns text language sql stable as $$
  select auth.jwt() ->> 'role';
$$;
grant execute on function auth.jwt(), auth.uid(), auth.role() to anon, authenticated, service_role;

-- Supabase ให้สิทธิ์ตาราง/ฟังก์ชันใหม่ใน public แก่ anon โดยอัตโนมัติ — จำลองให้เหมือนกัน
-- เพื่อทดสอบว่า migration ของเราปิดสิทธิ์ได้จริง
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

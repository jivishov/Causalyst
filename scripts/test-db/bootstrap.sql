-- Disposable test database only. Hosted auth and storage schemas are represented
-- by the columns/functions consumed by the committed migrations, not their APIs.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;
create schema auth;
create schema storage;
create table auth.users (
 id uuid primary key, email text, email_confirmed_at timestamptz,
 is_anonymous boolean default false, raw_app_meta_data jsonb default '{}'
);
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table auth.sessions (id uuid primary key, user_id uuid not null references auth.users(id), oauth_client_id uuid, not_after timestamptz, scopes text);
create function auth.jwt() returns jsonb language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, service_role;
grant all on storage.objects to authenticated, service_role;
grant usage on schema public, auth to anon, authenticated, service_role;
grant all on all tables in schema auth to service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to service_role;

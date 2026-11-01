begin;

create table if not exists public.custom_calendar_events (
    id uuid primary key default gen_random_uuid(),
    classroom_id uuid not null references public.checkin_classrooms(id) on delete cascade,
    created_by uuid not null references auth.users(id) on delete cascade,
    event_date date not null,
    end_date date not null,
    name text not null,
    description text not null default '',
    created_at timestamptz not null default now()
);

-- Preserve directly registered events from earlier versions, including one-day events.
alter table public.custom_calendar_events add column if not exists end_date date;
update public.custom_calendar_events set end_date = event_date where end_date is null;
alter table public.custom_calendar_events alter column end_date set not null;

-- NOT VALID keeps legacy rows intact while validating all new registrations.
do $$ begin
    if not exists (select 1 from pg_constraint where conrelid = 'public.custom_calendar_events'::regclass and conname = 'calendar_event_valid_range') then
        alter table public.custom_calendar_events add constraint calendar_event_valid_range check (end_date >= event_date) not valid;
    end if;
    if not exists (select 1 from pg_constraint where conrelid = 'public.custom_calendar_events'::regclass and conname = 'calendar_event_valid_name') then
        alter table public.custom_calendar_events add constraint calendar_event_valid_name check (char_length(btrim(name)) between 1 and 100) not valid;
    end if;
    if not exists (select 1 from pg_constraint where conrelid = 'public.custom_calendar_events'::regclass and conname = 'calendar_event_valid_description') then
        alter table public.custom_calendar_events add constraint calendar_event_valid_description check (char_length(description) <= 500) not valid;
    end if;
end $$;

create index if not exists calendar_events_classroom_dates_idx
    on public.custom_calendar_events(classroom_id, event_date, end_date);

-- Students cannot read checkin_classrooms directly. This helper checks membership
-- without changing the classroom table's existing owner-only policy.
create schema if not exists private;
grant usage on schema private to authenticated;
create or replace function private.can_access_calendar(p_classroom_id uuid, p_write boolean)
returns boolean language sql stable security definer set search_path = '' as $$
    select exists (
        select 1 from public.checkin_classrooms c
        where c.id = p_classroom_id and c.deleted_at is null and (
            c.owner_id = (select auth.uid()) or (
                not p_write and exists (
                    select 1 from public.checkin_members m
                    where m.classroom_id = c.id and m.user_id = (select auth.uid())
                )
            )
        )
    );
$$;
revoke all on function private.can_access_calendar(uuid, boolean) from public, anon;
grant execute on function private.can_access_calendar(uuid, boolean) to authenticated;

alter table public.custom_calendar_events enable row level security;
revoke all on public.custom_calendar_events from public, anon, authenticated;
grant select, insert, delete on public.custom_calendar_events to authenticated;

-- Restrictive guards also protect existing installations with permissive old policies.
drop policy if exists calendar_read on public.custom_calendar_events;
create policy calendar_read on public.custom_calendar_events for select to authenticated
    using (private.can_access_calendar(classroom_id, false));
drop policy if exists calendar_read_guard on public.custom_calendar_events;
create policy calendar_read_guard on public.custom_calendar_events as restrictive for select to authenticated
    using (private.can_access_calendar(classroom_id, false));

drop policy if exists calendar_insert on public.custom_calendar_events;
create policy calendar_insert on public.custom_calendar_events for insert to authenticated
    with check (created_by = (select auth.uid()) and private.can_access_calendar(classroom_id, true));
drop policy if exists calendar_insert_guard on public.custom_calendar_events;
create policy calendar_insert_guard on public.custom_calendar_events as restrictive for insert to authenticated
    with check (created_by = (select auth.uid()) and private.can_access_calendar(classroom_id, true));

drop policy if exists calendar_delete on public.custom_calendar_events;
create policy calendar_delete on public.custom_calendar_events for delete to authenticated
    using (private.can_access_calendar(classroom_id, true));
drop policy if exists calendar_delete_guard on public.custom_calendar_events;
create policy calendar_delete_guard on public.custom_calendar_events as restrictive for delete to authenticated
    using (private.can_access_calendar(classroom_id, true));

notify pgrst, 'reload schema';
commit;

begin;

create table if not exists public.checkin_classrooms (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    code text not null unique check (code ~ '^[A-Z0-9]{5}$'),
    class_name text not null check (char_length(btrim(class_name)) between 1 and 50),
    school_name text not null check (char_length(btrim(school_name)) between 1 and 120),
    latitude double precision not null check (latitude between -90 and 90),
    longitude double precision not null check (longitude between -180 and 180),
    radius_meters integer not null check (radius_meters between 50 and 500),
    created_at timestamptz not null default now()
);

create index if not exists checkin_classrooms_owner_idx on public.checkin_classrooms(owner_id);

create table if not exists public.checkin_members (
    classroom_id uuid not null references public.checkin_classrooms(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    display_name text not null check (char_length(btrim(display_name)) between 1 and 50),
    joined_at timestamptz not null default now(),
    primary key (classroom_id, user_id)
);

create index if not exists checkin_members_user_idx on public.checkin_members(user_id);

alter table public.checkin_classrooms enable row level security;
alter table public.checkin_members enable row level security;

drop policy if exists checkin_classrooms_select_owned on public.checkin_classrooms;
create policy checkin_classrooms_select_owned on public.checkin_classrooms
    for select to authenticated using (owner_id = (select auth.uid()));

drop policy if exists checkin_classrooms_insert_owned on public.checkin_classrooms;
create policy checkin_classrooms_insert_owned on public.checkin_classrooms
    for insert to authenticated with check (owner_id = (select auth.uid()));

drop policy if exists checkin_members_select_authorized on public.checkin_members;
create policy checkin_members_select_authorized on public.checkin_members
    for select to authenticated using (
        user_id = (select auth.uid()) or exists (
            select 1 from public.checkin_classrooms c
            where c.id = classroom_id and c.owner_id = (select auth.uid())
        )
    );

revoke all on public.checkin_classrooms, public.checkin_members from anon, authenticated;
grant select, insert on public.checkin_classrooms to authenticated;
grant select on public.checkin_members to authenticated;

-- All membership writes go through an authenticated, code-checked function.
-- The account ID always comes from the verified JWT, never from form input.
create or replace function public.join_checkin_classroom(p_code text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user uuid := auth.uid();
    v_class public.checkin_classrooms%rowtype;
    v_member public.checkin_members%rowtype;
begin
    if v_user is null then
        raise exception using errcode = 'P0001', message = 'LOGIN_REQUIRED';
    end if;
    if p_name is null or char_length(btrim(p_name)) not between 1 and 50 then
        raise exception using errcode = 'P0001', message = 'INVALID_NAME';
    end if;
    if p_code is null or upper(btrim(p_code)) !~ '^[A-Z0-9]{5}$' then
        raise exception using errcode = 'P0001', message = 'INVALID_CODE';
    end if;

    select * into v_class from public.checkin_classrooms where code = upper(btrim(p_code));
    if not found then
        raise exception using errcode = 'P0001', message = 'CLASS_NOT_FOUND';
    end if;

    insert into public.checkin_members (classroom_id, user_id, display_name)
    values (v_class.id, v_user, btrim(p_name))
    on conflict (classroom_id, user_id) do update
        set display_name = excluded.display_name
    returning * into v_member;

    return jsonb_build_object(
        'classId', v_class.id, 'className', v_class.class_name,
        'schoolName', v_class.school_name, 'code', v_class.code,
        'userId', v_member.user_id, 'name', v_member.display_name,
        'joinedAt', v_member.joined_at
    );
end;
$$;

revoke all on function public.join_checkin_classroom(text, text) from public, anon;
grant execute on function public.join_checkin_classroom(text, text) to authenticated;

notify pgrst, 'reload schema';
commit;

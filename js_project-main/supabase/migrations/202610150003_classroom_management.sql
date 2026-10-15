begin;

alter table public.checkin_classrooms add column if not exists deleted_at timestamptz;

-- Creation and joining take the same per-account lock to prevent competing tabs
-- from assigning both a teacher class and a student membership to one account.
create or replace function public.check_single_checkin_classroom()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.owner_id::text, 0));
    if new.deleted_at is null and (
        exists (select 1 from public.checkin_classrooms c where c.owner_id = new.owner_id and c.deleted_at is null and c.id <> new.id)
        or exists (
            select 1 from public.checkin_members m join public.checkin_classrooms c on c.id = m.classroom_id
            where m.user_id = new.owner_id and c.deleted_at is null
        )
    ) then
        raise exception using errcode = 'P0001', message = 'CLASS_EXISTS';
    end if;
    return new;
end;
$$;

drop trigger if exists check_single_checkin_classroom on public.checkin_classrooms;
create trigger check_single_checkin_classroom before insert on public.checkin_classrooms
    for each row execute function public.check_single_checkin_classroom();
revoke all on function public.check_single_checkin_classroom() from public, anon, authenticated;

create or replace function public.join_checkin_classroom(p_code text, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_user uuid := auth.uid();
    v_class public.checkin_classrooms%rowtype;
    v_member public.checkin_members%rowtype;
begin
    if v_user is null then raise exception using errcode = 'P0001', message = 'LOGIN_REQUIRED'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 0));
    if exists (select 1 from public.checkin_classrooms where owner_id = v_user and deleted_at is null)
        or exists (
            select 1 from public.checkin_members m join public.checkin_classrooms c on c.id = m.classroom_id
            where m.user_id = v_user and c.deleted_at is null
        ) then
        raise exception using errcode = 'P0001', message = 'CLASS_EXISTS';
    end if;
    if p_name is null or char_length(btrim(p_name)) not between 1 and 50 then
        raise exception using errcode = 'P0001', message = 'INVALID_NAME';
    end if;
    if p_code is null or upper(btrim(p_code)) !~ '^[A-Z0-9]{5}$' then
        raise exception using errcode = 'P0001', message = 'INVALID_CODE';
    end if;
    select * into v_class from public.checkin_classrooms
        where code = upper(btrim(p_code)) and deleted_at is null for update;
    if not found then raise exception using errcode = 'P0001', message = 'CLASS_NOT_FOUND'; end if;
    insert into public.checkin_members (classroom_id, user_id, display_name)
    values (v_class.id, v_user, btrim(p_name)) returning * into v_member;
    return jsonb_build_object(
        'classId', v_class.id, 'className', v_class.class_name,
        'schoolName', v_class.school_name, 'code', v_class.code,
        'userId', v_member.user_id, 'name', v_member.display_name, 'joinedAt', v_member.joined_at
    );
end;
$$;

create or replace function public.get_my_checkin_classrooms()
returns table (class_id uuid, class_name text, school_name text, code text, joined_at timestamptz)
language sql stable security definer set search_path = '' as $$
    select c.id, c.class_name, c.school_name, c.code, m.joined_at
    from public.checkin_members m join public.checkin_classrooms c on c.id = m.classroom_id
    where m.user_id = (select auth.uid()) and c.deleted_at is null
    order by m.joined_at desc, c.id;
$$;

create or replace function public.delete_checkin_classroom(p_classroom_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_class public.checkin_classrooms%rowtype;
begin
    if auth.uid() is null then raise exception using errcode = 'P0001', message = 'LOGIN_REQUIRED'; end if;
    select * into v_class from public.checkin_classrooms
        where id = p_classroom_id and owner_id = auth.uid() and deleted_at is null for update;
    if not found then raise exception using errcode = 'P0001', message = 'OWNER_REQUIRED'; end if;
    -- Preserve the ID as a tombstone against legacy browser imports.
    update public.checkin_classrooms set deleted_at = now() where id = p_classroom_id;
    return jsonb_build_object('success', true);
end;
$$;

create or replace function public.rename_checkin_member(p_classroom_id uuid, p_user_id uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
    if auth.uid() is null then raise exception using errcode = 'P0001', message = 'LOGIN_REQUIRED'; end if;
    perform 1 from public.checkin_classrooms
        where id = p_classroom_id and owner_id = auth.uid() and deleted_at is null for update;
    if not found then raise exception using errcode = 'P0001', message = 'OWNER_REQUIRED'; end if;
    if p_name is null or char_length(btrim(p_name)) not between 1 and 50 then
        raise exception using errcode = 'P0001', message = 'INVALID_NAME';
    end if;
    update public.checkin_members set display_name = btrim(p_name)
        where classroom_id = p_classroom_id and user_id = p_user_id;
    if not found then raise exception using errcode = 'P0001', message = 'MEMBER_NOT_FOUND'; end if;
    return jsonb_build_object('success', true);
end;
$$;

create or replace function public.remove_checkin_member(p_classroom_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
    if auth.uid() is null then raise exception using errcode = 'P0001', message = 'LOGIN_REQUIRED'; end if;
    perform 1 from public.checkin_classrooms
        where id = p_classroom_id and owner_id = auth.uid() and deleted_at is null for update;
    if not found then raise exception using errcode = 'P0001', message = 'OWNER_REQUIRED'; end if;
    delete from public.checkin_members where classroom_id = p_classroom_id and user_id = p_user_id;
    if not found then raise exception using errcode = 'P0001', message = 'MEMBER_NOT_FOUND'; end if;
    return jsonb_build_object('success', true);
end;
$$;

-- No direct update/delete grants: every action checks the class owner in its RPC.
revoke all on function public.join_checkin_classroom(text, text), public.get_my_checkin_classrooms(),
    public.delete_checkin_classroom(uuid), public.rename_checkin_member(uuid, uuid, text), public.remove_checkin_member(uuid, uuid)
    from public, anon;
grant execute on function public.join_checkin_classroom(text, text), public.get_my_checkin_classrooms(),
    public.delete_checkin_classroom(uuid), public.rename_checkin_member(uuid, uuid, text), public.remove_checkin_member(uuid, uuid)
    to authenticated;

drop policy if exists checkin_members_select_authorized on public.checkin_members;
create policy checkin_members_select_authorized on public.checkin_members for select to authenticated using (
    user_id = (select auth.uid()) or exists (
        select 1 from public.checkin_classrooms c
        where c.id = classroom_id and c.owner_id = (select auth.uid()) and c.deleted_at is null
    )
);

notify pgrst, 'reload schema';
commit;

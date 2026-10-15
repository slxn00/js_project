begin;

-- Withdrawal only removes the caller's own membership, never another account.
create or replace function public.leave_checkin_classroom(p_classroom_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_user uuid := auth.uid();
    v_class public.checkin_classrooms%rowtype;
begin
    if v_user is null then raise exception using errcode = 'P0001', message = 'LOGIN_REQUIRED'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 0));
    select * into v_class from public.checkin_classrooms where id = p_classroom_id for update;
    if found and v_class.owner_id = v_user and v_class.deleted_at is null then
        raise exception using errcode = 'P0001', message = 'OWN_CLASS_CANNOT_LEAVE';
    end if;
    -- Repeating withdrawal is safe when a teacher already removed this student.
    delete from public.checkin_members where classroom_id = p_classroom_id and user_id = v_user;
    return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.leave_checkin_classroom(uuid) from public, anon;
grant execute on function public.leave_checkin_classroom(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;

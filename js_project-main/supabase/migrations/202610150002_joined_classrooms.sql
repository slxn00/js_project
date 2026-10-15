begin;

-- Only return the signed-in account's own classroom memberships.
-- Joining a class does not grant access to its other members or admin controls.
create or replace function public.get_my_checkin_classrooms()
returns table (
    class_id uuid,
    class_name text,
    school_name text,
    code text,
    joined_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
    select c.id, c.class_name, c.school_name, c.code, m.joined_at
    from public.checkin_members m
    join public.checkin_classrooms c on c.id = m.classroom_id
    where m.user_id = (select auth.uid())
    order by m.joined_at desc, c.id;
$$;

revoke all on function public.get_my_checkin_classrooms() from public, anon;
grant execute on function public.get_my_checkin_classrooms() to authenticated;

notify pgrst, 'reload schema';
commit;

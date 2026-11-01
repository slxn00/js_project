-- Run after all migrations. Every fixture is rolled back.
begin;
do $$
declare
    owner_a uuid := gen_random_uuid();
    owner_b uuid := gen_random_uuid();
    student_a uuid := gen_random_uuid();
    student_b uuid := gen_random_uuid();
    class_a uuid := gen_random_uuid();
    class_b uuid := gen_random_uuid();
    codes text[] := array[]::text[];
    v_code text;
begin
    insert into auth.users (id, aud, role) values
        (owner_a, 'authenticated', 'authenticated'), (owner_b, 'authenticated', 'authenticated'),
        (student_a, 'authenticated', 'authenticated'), (student_b, 'authenticated', 'authenticated');
    while cardinality(codes) < 2 loop
        v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));
        if not v_code = any(codes) and not exists (select 1 from public.checkin_classrooms c where c.code = v_code) then
            codes := array_append(codes, v_code);
        end if;
    end loop;
    perform set_config('test.owner_a', owner_a::text, true);
    perform set_config('test.owner_b', owner_b::text, true);
    perform set_config('test.student_a', student_a::text, true);
    perform set_config('test.student_b', student_b::text, true);
    perform set_config('test.class_a', class_a::text, true);
    perform set_config('test.class_b', class_b::text, true);
    insert into public.checkin_classrooms (id, owner_id, code, class_name, school_name, latitude, longitude, radius_meters) values
        (class_a, owner_a, codes[1], '일정 A', '검증 학교', 37, 127, 100),
        (class_b, owner_b, codes[2], '일정 B', '검증 학교', 37, 127, 100);
    insert into public.checkin_members (classroom_id, user_id, display_name) values
        (class_a, student_a, 'A 학생'), (class_b, student_b, 'B 학생');
end $$;

-- Simulate an old broad policy to verify restrictive guards cannot be bypassed.
create policy calendar_test_legacy_open on public.custom_calendar_events for all to authenticated using (true) with check (true);
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.owner_a'), true);
do $$ begin
    insert into public.custom_calendar_events (classroom_id, created_by, event_date, end_date, name)
    values (current_setting('test.class_a')::uuid, auth.uid(), '2026-11-03', '2026-11-05', '중간고사');
    if (select count(*) from public.custom_calendar_events where classroom_id = current_setting('test.class_a')::uuid) <> 1 then
        raise exception 'TEST_FAIL: owner cannot read saved event';
    end if;
    begin
        insert into public.custom_calendar_events (classroom_id, created_by, event_date, end_date, name)
        values (current_setting('test.class_a')::uuid, current_setting('test.owner_b')::uuid, '2026-11-03', '2026-11-03', '작성자 위조');
        raise exception 'TEST_FAIL: forged creator accepted';
    exception when insufficient_privilege then null; end;
    begin
        insert into public.custom_calendar_events (classroom_id, created_by, event_date, end_date, name)
        values (current_setting('test.class_a')::uuid, auth.uid(), '2026-11-05', '2026-11-03', '날짜 역전');
        raise exception 'TEST_FAIL: invalid dates accepted';
    exception when check_violation then null; end;
end $$;

select set_config('request.jwt.claim.sub', current_setting('test.student_a'), true);
do $$ begin
    if (select count(*) from public.custom_calendar_events where classroom_id = current_setting('test.class_a')::uuid) <> 1 then
        raise exception 'TEST_FAIL: enrolled student cannot read event';
    end if;
    begin
        insert into public.custom_calendar_events (classroom_id, created_by, event_date, end_date, name)
        values (current_setting('test.class_a')::uuid, auth.uid(), '2026-11-03', '2026-11-03', '학생 등록');
        raise exception 'TEST_FAIL: student can register event';
    exception when insufficient_privilege then null; end;
    delete from public.custom_calendar_events where classroom_id = current_setting('test.class_a')::uuid;
    if not exists (select 1 from public.custom_calendar_events where classroom_id = current_setting('test.class_a')::uuid) then
        raise exception 'TEST_FAIL: student deleted event';
    end if;
    begin
        update public.custom_calendar_events set name = '학생 수정' where classroom_id = current_setting('test.class_a')::uuid;
        raise exception 'TEST_FAIL: student can update event';
    exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub', current_setting('test.student_b'), true);
do $$ begin
    if exists (select 1 from public.custom_calendar_events where classroom_id = current_setting('test.class_a')::uuid) then
        raise exception 'TEST_FAIL: other class student can read event';
    end if;
end $$;
select set_config('request.jwt.claim.sub', current_setting('test.owner_b'), true);
do $$ begin
    if exists (select 1 from public.custom_calendar_events where classroom_id = current_setting('test.class_a')::uuid) then
        raise exception 'TEST_FAIL: other class owner can read event';
    end if;
    begin
        insert into public.custom_calendar_events (classroom_id, created_by, event_date, end_date, name)
        values (current_setting('test.class_a')::uuid, auth.uid(), '2026-11-03', '2026-11-03', '타 학급 등록');
        raise exception 'TEST_FAIL: other owner can register event';
    exception when insufficient_privilege then null; end;
end $$;

-- Withdrawal revokes access immediately, even with a valid login session.
select set_config('request.jwt.claim.sub', current_setting('test.student_a'), true);
select public.leave_checkin_classroom(current_setting('test.class_a')::uuid);
do $$ begin
    if exists (select 1 from public.custom_calendar_events where classroom_id = current_setting('test.class_a')::uuid) then
        raise exception 'TEST_FAIL: former member can read event';
    end if;
end $$;
select set_config('request.jwt.claim.sub', current_setting('test.owner_a'), true);
do $$ begin
    delete from public.custom_calendar_events where classroom_id = current_setting('test.class_a')::uuid;
    if exists (select 1 from public.custom_calendar_events where classroom_id = current_setting('test.class_a')::uuid) then
        raise exception 'TEST_FAIL: owner cannot delete event';
    end if;
    insert into public.custom_calendar_events (classroom_id, created_by, event_date, end_date, name)
    values (current_setting('test.class_a')::uuid, auth.uid(), '2026-11-03', '2026-11-03', '학급 삭제 전 일정');
    perform public.delete_checkin_classroom(current_setting('test.class_a')::uuid);
    if exists (select 1 from public.custom_calendar_events where classroom_id = current_setting('test.class_a')::uuid) then
        raise exception 'TEST_FAIL: deleted classroom events still visible';
    end if;
end $$;
reset role;
set local role anon;
do $$ begin
    begin
        perform * from public.custom_calendar_events;
        raise exception 'TEST_FAIL: anonymous access allowed';
    exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'PASS: teacher registration/deletion, enrolled-student read, other-class isolation, withdrawal/deletion revocation, anonymous denial, legacy-policy guards. Fixtures rolled back.' as result;

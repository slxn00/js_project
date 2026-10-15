-- Fixture accounts and all changes are rolled back. Existing records are untouched.
begin;
do $$
declare
    v_owner_a uuid := gen_random_uuid();
    v_owner_b uuid := gen_random_uuid();
    v_student uuid := gen_random_uuid();
    v_other_a uuid := gen_random_uuid();
    v_other_b uuid := gen_random_uuid();
    v_class_a uuid := gen_random_uuid();
    v_class_b uuid := gen_random_uuid();
    v_codes text[] := array[]::text[];
    v_code text;
begin
    insert into auth.users (id, aud, role) values
        (v_owner_a, 'authenticated', 'authenticated'), (v_owner_b, 'authenticated', 'authenticated'),
        (v_student, 'authenticated', 'authenticated'), (v_other_a, 'authenticated', 'authenticated'), (v_other_b, 'authenticated', 'authenticated');
    while cardinality(v_codes) < 3 loop
        v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));
        if not v_code = any(v_codes) and not exists (select 1 from public.checkin_classrooms where code = v_code) then v_codes := array_append(v_codes, v_code); end if;
    end loop;
    perform set_config('test.owner_a', v_owner_a::text, true);
    perform set_config('test.owner_b', v_owner_b::text, true);
    perform set_config('test.student', v_student::text, true);
    perform set_config('test.class_a', v_class_a::text, true);
    perform set_config('test.class_b', v_class_b::text, true);
    perform set_config('test.code_a', v_codes[1], true);
    perform set_config('test.code_b', v_codes[2], true);
    perform set_config('test.code_new', v_codes[3], true);
    insert into public.checkin_classrooms (id, owner_id, code, class_name, school_name, latitude, longitude, radius_meters) values
        (v_class_a, v_owner_a, v_codes[1], '탈퇴 검증 A', '검증 학교', 37, 127, 100),
        (v_class_b, v_owner_b, v_codes[2], '탈퇴 검증 B', '검증 학교', 37, 127, 100);
    insert into public.checkin_members (classroom_id, user_id, display_name) values
        (v_class_a, v_other_a, '남아 있는 A 학생'), (v_class_b, v_other_b, '남아 있는 B 학생');
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.student'), true) is not null as student_context;
do $$ begin
    perform public.join_checkin_classroom(current_setting('test.code_a'), '탈퇴할 학생');
    perform public.leave_checkin_classroom(current_setting('test.class_b')::uuid);
    if (select count(*) from public.get_my_checkin_classrooms()) <> 1 then raise exception 'TEST_FAIL: unrelated class affected own membership'; end if;
    perform public.leave_checkin_classroom(current_setting('test.class_a')::uuid);
    perform public.leave_checkin_classroom(current_setting('test.class_a')::uuid);
    if exists (select 1 from public.get_my_checkin_classrooms()) then raise exception 'TEST_FAIL: membership remains after leaving'; end if;
    perform public.join_checkin_classroom(current_setting('test.code_b'), '다른 학급 입장');
    if not exists (select 1 from public.get_my_checkin_classrooms() where class_id = current_setting('test.class_b')::uuid) then raise exception 'TEST_FAIL: cannot join another class'; end if;
    perform public.leave_checkin_classroom(current_setting('test.class_b')::uuid);
    insert into public.checkin_classrooms (owner_id, code, class_name, school_name, latitude, longitude, radius_meters)
    values (auth.uid(), current_setting('test.code_new'), '탈퇴 후 생성', '검증 학교', 37, 127, 100);
    begin
        perform public.leave_checkin_classroom((select id from public.checkin_classrooms where code = current_setting('test.code_new')));
        raise exception 'TEST_FAIL: owner left their own class';
    exception when raise_exception then if sqlerrm <> 'OWN_CLASS_CANNOT_LEAVE' then raise; end if; end;
end $$;

select set_config('request.jwt.claim.sub', current_setting('test.owner_a'), true) is not null as owner_a_context;
do $$ begin
    if (select count(*) from public.checkin_members where classroom_id = current_setting('test.class_a')::uuid) <> 1 then raise exception 'TEST_FAIL: other A student affected'; end if;
end $$;
select set_config('request.jwt.claim.sub', current_setting('test.owner_b'), true) is not null as owner_b_context;
do $$ begin
    if (select count(*) from public.checkin_members where classroom_id = current_setting('test.class_b')::uuid) <> 1 then raise exception 'TEST_FAIL: other B student affected'; end if;
end $$;
select set_config('request.jwt.claim.sub', '', true) is not null as signed_out_context;
do $$ begin
    begin
        perform public.leave_checkin_classroom(current_setting('test.class_a')::uuid);
        raise exception 'TEST_FAIL: signed-out withdrawal accepted';
    exception when raise_exception then if sqlerrm <> 'LOGIN_REQUIRED' then raise; end if; end;
end $$;
reset role;
do $$ begin
    if has_function_privilege('anon', 'public.leave_checkin_classroom(uuid)', 'execute') then raise exception 'TEST_FAIL: anonymous withdrawal allowed'; end if;
    if not exists (select 1 from auth.users where id = current_setting('test.student')::uuid) then raise exception 'TEST_FAIL: account removed'; end if;
end $$;
rollback;
select 'PASS: self-only withdrawal, repeated withdrawal, other members preserved, rejoin and creation after leaving, owner and signed-out restrictions. Fixtures rolled back.' as result;

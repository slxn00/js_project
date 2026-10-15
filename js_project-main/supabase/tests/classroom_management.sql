-- Run as postgres in SQL Editor after the migrations.
-- All fixture accounts, classes and mutations are rolled back.
begin;
do $$
declare
    v_owner uuid := gen_random_uuid();
    v_student uuid := gen_random_uuid();
    v_outsider uuid := gen_random_uuid();
    v_class uuid := gen_random_uuid();
    v_code text;
begin
    insert into auth.users (id, aud, role) values
        (v_owner, 'authenticated', 'authenticated'),
        (v_student, 'authenticated', 'authenticated'),
        (v_outsider, 'authenticated', 'authenticated');
    loop
        v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));
        exit when not exists (select 1 from public.checkin_classrooms where code = v_code);
    end loop;
    perform set_config('test.owner_id', v_owner::text, true);
    perform set_config('test.student_id', v_student::text, true);
    perform set_config('test.outsider_id', v_outsider::text, true);
    perform set_config('test.class_id', v_class::text, true);
    perform set_config('test.class_code', v_code, true);
    insert into public.checkin_classrooms (id, owner_id, code, class_name, school_name, latitude, longitude, radius_meters)
    values (v_class, v_owner, v_code, '권한 검증용', '검증 학교', 37, 127, 100);
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.student_id'), true) is not null as student_context;
do $$
declare v_result jsonb;
begin
    v_result := public.join_checkin_classroom(current_setting('test.class_code'), '검증 학생');
    if v_result->>'userId' <> auth.uid()::text then raise exception 'TEST_FAIL: untrusted account'; end if;
    if (select count(*) from public.get_my_checkin_classrooms()) <> 1 then raise exception 'TEST_FAIL: student class missing'; end if;
    begin
        perform public.join_checkin_classroom(current_setting('test.class_code'), '중복 학생');
        raise exception 'TEST_FAIL: duplicate join accepted';
    exception when raise_exception then if sqlerrm <> 'CLASS_EXISTS' then raise; end if; end;
    begin
        insert into public.checkin_classrooms (owner_id, code, class_name, school_name, latitude, longitude, radius_meters)
        values (auth.uid(), current_setting('test.class_code'), '학생의 생성 시도', '검증 학교', 37, 127, 100);
        raise exception 'TEST_FAIL: student created class';
    exception when raise_exception then if sqlerrm <> 'CLASS_EXISTS' then raise; end if; end;
    begin
        perform public.rename_checkin_member(current_setting('test.class_id')::uuid, auth.uid(), '학생의 수정 시도');
        raise exception 'TEST_FAIL: student renamed member';
    exception when raise_exception then if sqlerrm <> 'OWNER_REQUIRED' then raise; end if; end;
    begin
        perform public.remove_checkin_member(current_setting('test.class_id')::uuid, auth.uid());
        raise exception 'TEST_FAIL: student removed member';
    exception when raise_exception then if sqlerrm <> 'OWNER_REQUIRED' then raise; end if; end;
end $$;

select set_config('request.jwt.claim.sub', current_setting('test.outsider_id'), true) is not null as outsider_context;
do $$ begin
    if exists (select 1 from public.checkin_members where classroom_id = current_setting('test.class_id')::uuid) then
        raise exception 'TEST_FAIL: outsider can read members';
    end if;
    begin
        perform public.delete_checkin_classroom(current_setting('test.class_id')::uuid);
        raise exception 'TEST_FAIL: outsider deleted class';
    exception when raise_exception then if sqlerrm <> 'OWNER_REQUIRED' then raise; end if; end;
    begin
        perform public.rename_checkin_member(current_setting('test.class_id')::uuid, current_setting('test.student_id')::uuid, '외부 수정');
        raise exception 'TEST_FAIL: outsider renamed member';
    exception when raise_exception then if sqlerrm <> 'OWNER_REQUIRED' then raise; end if; end;
    begin
        perform public.remove_checkin_member(current_setting('test.class_id')::uuid, current_setting('test.student_id')::uuid);
        raise exception 'TEST_FAIL: outsider removed member';
    exception when raise_exception then if sqlerrm <> 'OWNER_REQUIRED' then raise; end if; end;
end $$;

select set_config('request.jwt.claim.sub', current_setting('test.owner_id'), true) is not null as owner_context;
do $$ begin
    begin
        perform public.join_checkin_classroom(current_setting('test.class_code'), '선생님의 입장 시도');
        raise exception 'TEST_FAIL: owner joined class';
    exception when raise_exception then if sqlerrm <> 'CLASS_EXISTS' then raise; end if; end;
    begin
        insert into public.checkin_classrooms (owner_id, code, class_name, school_name, latitude, longitude, radius_meters)
        values (auth.uid(), current_setting('test.class_code'), '두 번째 학급', '검증 학교', 37, 127, 100);
        raise exception 'TEST_FAIL: owner created second class';
    exception when raise_exception then if sqlerrm <> 'CLASS_EXISTS' then raise; end if; end;
    perform public.rename_checkin_member(current_setting('test.class_id')::uuid, current_setting('test.student_id')::uuid, ' 수정된 학생 ');
    if not exists (select 1 from public.checkin_members where classroom_id = current_setting('test.class_id')::uuid and display_name = '수정된 학생') then
        raise exception 'TEST_FAIL: owner rename missing';
    end if;
    perform public.remove_checkin_member(current_setting('test.class_id')::uuid, current_setting('test.student_id')::uuid);
    if exists (select 1 from public.checkin_members where classroom_id = current_setting('test.class_id')::uuid) then
        raise exception 'TEST_FAIL: owner removal missing';
    end if;
end $$;

select set_config('request.jwt.claim.sub', current_setting('test.student_id'), true) is not null as student_context;
do $$ begin
    if exists (select 1 from public.get_my_checkin_classrooms()) then raise exception 'TEST_FAIL: removed student still belongs to class'; end if;
    perform public.join_checkin_classroom(current_setting('test.class_code'), '다시 입장');
end $$;

select set_config('request.jwt.claim.sub', current_setting('test.owner_id'), true) is not null as owner_context;
select public.delete_checkin_classroom(current_setting('test.class_id')::uuid)->>'success' = 'true' as class_deleted;
select set_config('request.jwt.claim.sub', current_setting('test.student_id'), true) is not null as student_context;
do $$
declare v_new_code text;
begin
    if exists (select 1 from public.get_my_checkin_classrooms()) then raise exception 'TEST_FAIL: deleted class still visible'; end if;
    begin
        perform public.join_checkin_classroom(current_setting('test.class_code'), '삭제 학급 입장');
        raise exception 'TEST_FAIL: deleted class accepted join';
    exception when raise_exception then if sqlerrm <> 'CLASS_NOT_FOUND' then raise; end if; end;
    loop
        v_new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));
        exit when v_new_code <> current_setting('test.class_code');
    end loop;
    insert into public.checkin_classrooms (owner_id, code, class_name, school_name, latitude, longitude, radius_meters)
    values (auth.uid(), v_new_code, '새 학급', '검증 학교', 37, 127, 100);
end $$;

reset role;
do $$ begin
    if not exists (select 1 from public.checkin_classrooms where id = current_setting('test.class_id')::uuid and deleted_at is not null) then
        raise exception 'TEST_FAIL: deleted class tombstone missing';
    end if;
    if (select count(*) from auth.users where id in (current_setting('test.owner_id')::uuid, current_setting('test.student_id')::uuid, current_setting('test.outsider_id')::uuid)) <> 3 then
        raise exception 'TEST_FAIL: account was deleted';
    end if;
    if has_function_privilege('anon', 'public.delete_checkin_classroom(uuid)', 'execute')
        or has_function_privilege('anon', 'public.rename_checkin_member(uuid,uuid,text)', 'execute')
        or has_function_privilege('anon', 'public.remove_checkin_member(uuid,uuid)', 'execute') then
        raise exception 'TEST_FAIL: anonymous management enabled';
    end if;
end $$;
rollback;
select 'PASS: one-class restriction, teacher-only changes, student removal, class deletion and account preservation. All fixtures rolled back.' as result;

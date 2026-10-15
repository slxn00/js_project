import test from 'node:test'
import assert from 'node:assert/strict'
import { createClassroomStore } from '../src/js/classroom-store.js'

const owner = { id: 'owner-id' }
const legacy = { id: 'class-id', code: 'S42HN', className: '3반', school: { name: '미림마이스터고등학교', latitude: 37.4664, longitude: 126.9327 }, radiusMeters: 100, createdAt: '2026-10-15T10:00:00Z' }
const row = { id: legacy.id, owner_id: owner.id, code: legacy.code, class_name: legacy.className, school_name: legacy.school.name, latitude: legacy.school.latitude, longitude: legacy.school.longitude, radius_meters: legacy.radiusMeters, created_at: legacy.createdAt }

function fakeClient({ user = owner, rows = [], members = [], joined = [], rpcError = null, queryError = null } = {}) {
    const calls = []
    const classes = [...rows]
    return {
        calls, classes,
        auth: { getUser: async () => ({ data: { user }, error: null }) },
        async rpc(name, args) {
            calls.push({ rpc: name, args })
            if (rpcError) return { data: null, error: rpcError }
            if (name === 'get_my_checkin_classrooms') return { data: joined, error: null }
            if (['delete_checkin_classroom', 'rename_checkin_member', 'remove_checkin_member', 'leave_checkin_classroom'].includes(name)) return { data: { success: true }, error: null }
            return { data: { classId: 'class-id', userId: user.id, className: '3반', name: args.p_name, joinedAt: '2026-10-15T10:00:00Z' }, error: null }
        },
        from(table) {
            const call = { table, filters: [] }
            calls.push(call)
            const query = {
                select(columns) { call.columns = columns; return query },
                eq(key, value) { call.filters.push([key, value]); return query },
                order(column) { call.order = column; return query },
                insert(value) { call.insert = value; return query },
                async single() {
                    if (queryError) return { error: queryError }
                    classes.push(call.insert)
                    return { data: call.insert, error: null }
                },
                then(resolve, reject) {
                    const source = table === 'checkin_classrooms' ? classes : members
                    return Promise.resolve(queryError ? { error: queryError } : { data: source.filter(item => call.filters.every(([key, value]) => item[key] === value)), error: null }).then(resolve, reject)
                },
            }
            return query
        },
    }
}

test('입장은 로그인 계정으로 수행하고 사용자 ID를 폼에서 전달하지 않는다', async () => {
    const client = fakeClient()
    const result = await createClassroomStore(client).joinClass({ name: ' 민서연 ', code: 's42hn', userId: 'spoofed-user' })
    assert.equal(result.userId, owner.id)
    assert.deepEqual(client.calls, [{ rpc: 'join_checkin_classroom', args: { p_code: 'S42HN', p_name: '민서연' } }])
})

test('로그인하지 않은 사용자는 멤버 등록 함수를 호출하지 않는다', async () => {
    const client = fakeClient({ user: null })
    await assert.rejects(createClassroomStore(client).joinClass({ name: '민서연', code: 'S42HN' }), /로그인/)
    assert.equal(client.calls.length, 0)
})

test('없는 학급코드의 서버 오류를 성공으로 처리하지 않는다', async () => {
    const client = fakeClient({ rpcError: { code: 'P0001', message: 'CLASS_NOT_FOUND' } })
    await assert.rejects(createClassroomStore(client).joinClass({ name: '민서연', code: 'WR0NG' }), /해당 학급코드가 없어요/)
})

test('DB 연결 키 오류를 안내한다', async () => {
    const client = fakeClient({ queryError: { message: 'Invalid API key' } })
    await assert.rejects(createClassroomStore(client).getOwnedClasses(), /연결 키/)
})

test('새 학급의 소유자는 입력값 대신 로그인 계정으로 저장한다', async () => {
    const client = fakeClient()
    await createClassroomStore(client).createClass({ ...legacy, owner_id: 'spoofed-owner' })
    assert.equal(client.classes[0].owner_id, owner.id)
    assert.equal(client.classes[0].code, 'S42HN')
})

test('기존 로컬 학급은 코드와 ID를 보존해 한 번만 이전한다', async () => {
    const client = fakeClient()
    const store = createClassroomStore(client)
    await store.getOwnedClasses([legacy])
    const second = await store.getOwnedClasses([legacy])
    assert.equal(client.classes.length, 1)
    assert.equal(second[0].id, legacy.id)
    assert.equal(second[0].code, legacy.code)
})

test('학급 목록 조회는 로그인 계정이 소유한 학급으로 제한한다', async () => {
    const client = fakeClient({ rows: [row, { ...row, id: 'another-class', owner_id: 'another-owner' }] })
    const result = await createClassroomStore(client).getOwnedClasses()
    assert.equal(result.length, 1)
    assert.deepEqual(client.calls[0].filters, [['owner_id', owner.id]])
})

test('멤버 목록은 선택한 학급만 조회하고 이름과 입장 시각을 표시한다', async () => {
    const client = fakeClient({ members: [{ classroom_id: 'class-id', user_id: 'student-id', display_name: '민서연', joined_at: '2026-10-15T10:00:00Z' }, { classroom_id: 'another-class', user_id: 'another-student', display_name: '다른 학급', joined_at: '2026-10-15T10:00:00Z' }] })
    const members = await createClassroomStore(client).getMembers('class-id')
    assert.deepEqual(members, [{ classId: 'class-id', userId: 'student-id', name: '민서연', joinedAt: '2026-10-15T10:00:00Z' }])
    assert.equal(client.calls[0].columns, 'classroom_id,user_id,display_name,joined_at')
})

test('데이터베이스 미설정 오류는 빈 멤버 목록으로 숨기지 않는다', async () => {
    const client = fakeClient({ queryError: { code: 'PGRST205', message: 'Table not found' } })
    await assert.rejects(createClassroomStore(client).getMembers('class-id'), /데이터베이스가 아직 준비되지/)
})

test('내 클래스는 로그인 계정의 입장 기록을 조회하며 관리자 목록과 별개로 불러온다', async () => {
    const client = fakeClient({ joined: [{ class_id: 'joined-class', class_name: '테스트용 클래스', school_name: '미림마이스터고등학교', code: 'T3ST1', joined_at: '2026-10-15T10:00:00Z' }] })
    const store = createClassroomStore(client)
    const first = await store.getJoinedClasses()
    const afterReload = await createClassroomStore(client).getJoinedClasses()
    assert.deepEqual(first, [{ id: 'joined-class', className: '테스트용 클래스', school: { name: '미림마이스터고등학교' }, code: 'T3ST1', joinedAt: '2026-10-15T10:00:00Z' }])
    assert.deepEqual(afterReload, first)
    assert.ok(client.calls.every(call => call.rpc === 'get_my_checkin_classrooms' && call.args === undefined))
})

test('로그인하지 않으면 내 클래스 조회를 요청하지 않는다', async () => {
    const client = fakeClient({ user: null })
    await assert.rejects(createClassroomStore(client).getJoinedClasses(), /로그인/)
    assert.equal(client.calls.length, 0)
})

test('내 클래스 조회 실패를 빈 목록으로 처리하지 않는다', async () => {
    const client = fakeClient({ rpcError: { message: 'Network error' } })
    await assert.rejects(createClassroomStore(client).getJoinedClasses(), /네트워크/)
})

test('이미 학급이 있는 계정의 입장을 서버가 거부하면 지정된 오류를 표시한다', async () => {
    const store = createClassroomStore(fakeClient({ rpcError: { message: 'CLASS_EXISTS' } }))
    await assert.rejects(store.joinClass({ name: '학생', code: 'S42HN' }), /^Error: 학급이 있으면 안됩니다$/)
})

test('삭제한 학급은 기존 로컬 백업이 남아 있어도 다시 생성하거나 표시하지 않는다', async () => {
    const client = fakeClient({ rows: [{ ...row, deleted_at: '2026-10-15T12:00:00Z' }] })
    const classes = await createClassroomStore(client).getOwnedClasses([legacy])
    assert.deepEqual(classes, [])
    assert.equal(client.classes.length, 1)
    assert.ok(!client.calls.some(call => call.insert))
})

test('학급 삭제·학생 삭제·이름 수정은 대상 ID만 전달하고 선생님 ID는 전달하지 않는다', async () => {
    const client = fakeClient()
    const store = createClassroomStore(client)
    await store.deleteClass('class-id')
    await store.removeMember('class-id', 'student-id')
    await store.renameMember('class-id', 'student-id', ' 새 이름 ')
    assert.deepEqual(client.calls, [
        { rpc: 'delete_checkin_classroom', args: { p_classroom_id: 'class-id' } },
        { rpc: 'remove_checkin_member', args: { p_classroom_id: 'class-id', p_user_id: 'student-id' } },
        { rpc: 'rename_checkin_member', args: { p_classroom_id: 'class-id', p_user_id: 'student-id', p_name: '새 이름' } },
    ])
})

test('다른 선생님의 학급을 관리하려 하면 권한 오류를 성공으로 처리하지 않는다', async () => {
    const store = createClassroomStore(fakeClient({ rpcError: { message: 'OWNER_REQUIRED' } }))
    await assert.rejects(store.deleteClass('other-class'), /해당 학급의 선생님만/)
    await assert.rejects(store.removeMember('other-class', 'student-id'), /해당 학급의 선생님만/)
    await assert.rejects(store.renameMember('other-class', 'student-id', '수정'), /해당 학급의 선생님만/)
})

test('비로그인 관리 요청과 빈 학생 이름은 서버에 전송하지 않는다', async () => {
    const client = fakeClient({ user: null })
    const store = createClassroomStore(client)
    await assert.rejects(store.deleteClass('class-id'), /로그인/)
    await assert.rejects(store.removeMember('class-id', 'student-id'), /로그인/)
    await assert.rejects(store.renameMember('class-id', 'student-id', '학생'), /로그인/)
    await assert.rejects(store.renameMember('class-id', 'student-id', ' '), /성함/)
    assert.equal(client.calls.length, 0)
})

test('학급 탈퇴는 사용자 ID를 입력받지 않고 본인 탈퇴 함수에 학급 ID만 전달한다', async () => {
    const client = fakeClient()
    await createClassroomStore(client).leaveClass('class-id', 'another-student')
    assert.deepEqual(client.calls, [{ rpc: 'leave_checkin_classroom', args: { p_classroom_id: 'class-id' } }])
})

test('비로그인 학급 탈퇴는 요청하지 않으며 서버 오류도 성공으로 처리하지 않는다', async () => {
    const client = fakeClient({ user: null })
    await assert.rejects(createClassroomStore(client).leaveClass('class-id'), /로그인/)
    assert.equal(client.calls.length, 0)
    await assert.rejects(createClassroomStore(fakeClient({ rpcError: { message: 'Network error' } })).leaveClass('class-id'), /네트워크/)
})

test('선생님이 직접 만든 학급은 탈퇴 대신 학급 삭제를 안내한다', async () => {
    await assert.rejects(createClassroomStore(fakeClient({ rpcError: { message: 'OWN_CLASS_CANNOT_LEAVE' } })).leaveClass('class-id'), /직접 만든 학급은 탈퇴할 수 없어요/)
})

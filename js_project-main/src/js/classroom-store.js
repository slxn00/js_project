export function classroomError(error) {
    const message = error?.message || ''
    if (/Invalid API key/i.test(message)) return new Error('데이터베이스 연결 키를 확인해 주세요.')
    if (['PGRST205', 'PGRST202', '42P01', '42883'].includes(error?.code)) return new Error('학급 데이터베이스가 아직 준비되지 않았어요. 관리자에게 문의해 주세요.')
    if (/CLASS_NOT_FOUND/.test(message)) return new Error('해당 학급코드가 없어요. 코드를 다시 확인해 주세요.')
    if (/CLASS_EXISTS/.test(message)) return new Error('학급이 있으면 안됩니다')
    if (/OWNER_REQUIRED/.test(message)) return new Error('해당 학급의 선생님만 관리할 수 있어요.')
    if (/OWN_CLASS_CANNOT_LEAVE/.test(message)) return new Error('직접 만든 학급은 탈퇴할 수 없어요. 학급 삭제를 이용해 주세요.')
    if (/MEMBER_NOT_FOUND/.test(message)) return new Error('이미 삭제되었거나 학급에 없는 학생이에요.')
    if (/LOGIN_REQUIRED/.test(message)) return new Error('로그인 후 학급에 입장해 주세요.')
    if (/INVALID_NAME/.test(message)) return new Error('성함을 1~50자로 입력해 주세요.')
    if (/INVALID_CODE/.test(message)) return new Error('학급코드 5자리를 확인해 주세요.')
    if (error?.code === '23505') return new Error('이미 사용 중인 학급코드입니다. 다시 생성해 주세요.')
    if (/fetch|network/i.test(message)) return new Error('서버에 연결하지 못했어요. 네트워크를 확인해 주세요.')
    return new Error(message || '학급 정보를 불러오지 못했어요. 다시 시도해 주세요.')
}

function fromRow(row) {
    return { id: row.id, ownerId: row.owner_id, code: row.code, className: row.class_name, school: { name: row.school_name, latitude: row.latitude, longitude: row.longitude }, radiusMeters: row.radius_meters, createdAt: row.created_at, deletedAt: row.deleted_at || null }
}

export function createClassroomStore(client) {
    async function currentUser() {
        const { data, error } = await client.auth.getUser()
        if (error || !data.user) throw new Error('로그인 후 학급을 이용해 주세요.')
        return data.user
    }
    async function ownedClasses(user) {
        const { data, error } = await client.from('checkin_classrooms').select('*').eq('owner_id', user.id).order('created_at')
        if (error) throw classroomError(error)
        return data.map(fromRow)
    }
    async function insertClass(user, item) {
        const row = { id: item.id, owner_id: user.id, code: item.code, class_name: item.className, school_name: item.school.name, latitude: item.school.latitude, longitude: item.school.longitude, radius_meters: item.radiusMeters, created_at: item.createdAt }
        const { data, error } = await client.from('checkin_classrooms').insert(row).select('*').single()
        if (error) throw classroomError(error)
        return fromRow(data)
    }
    async function managementRequest(name, args) {
        await currentUser()
        const { data, error } = await client.rpc(name, args)
        if (error) throw classroomError(error)
        if (data?.success !== true) throw new Error('변경 결과를 확인하지 못했어요. 다시 시도해 주세요.')
        return data
    }
    return {
        async getOwnedClasses(legacyClasses = []) {
            const user = await currentUser()
            const classes = await ownedClasses(user)
            // Preserve the codes of this administrator's existing local classes.
            for (const legacy of legacyClasses) {
                if (classes.some(item => item.id === legacy.id)) continue
                try { classes.push(await insertClass(user, legacy)) }
                catch (error) {
                    // Another tab may have migrated the same class simultaneously.
                    const latest = await ownedClasses(user)
                    if (!latest.some(item => item.id === legacy.id)) throw error
                    classes.splice(0, classes.length, ...latest)
                }
            }
            // A deleted class remains a tombstone so another browser cannot re-import it.
            return classes.filter(item => !item.deletedAt)
        },
        async createClass(item) { return insertClass(await currentUser(), item) },
        async getJoinedClasses() {
            await currentUser()
            const { data, error } = await client.rpc('get_my_checkin_classrooms')
            if (error) throw classroomError(error)
            return (data || []).map(row => ({
                id: row.class_id, className: row.class_name,
                school: { name: row.school_name }, code: row.code, joinedAt: row.joined_at,
            }))
        },
        async joinClass({ name, code }) {
            await currentUser()
            const cleanName = name.trim()
            const cleanCode = code.trim().toUpperCase()
            if (!cleanName || cleanName.length > 50) throw new Error('성함을 1~50자로 입력해 주세요.')
            if (!/^[A-Z0-9]{5}$/.test(cleanCode)) throw new Error('학급코드 5자리를 확인해 주세요.')
            const { data, error } = await client.rpc('join_checkin_classroom', { p_code: cleanCode, p_name: cleanName })
            if (error) throw classroomError(error)
            if (!data?.classId || !data.userId || !data.joinedAt) throw new Error('입장 결과를 확인하지 못했어요. 다시 시도해 주세요.')
            return data
        },
        async getMembers(classId) {
            await currentUser()
            const { data, error } = await client.from('checkin_members').select('classroom_id,user_id,display_name,joined_at').eq('classroom_id', classId).order('joined_at')
            if (error) throw classroomError(error)
            return data.map(row => ({ classId: row.classroom_id, userId: row.user_id, name: row.display_name, joinedAt: row.joined_at }))
        },
        async deleteClass(classId) {
            return managementRequest('delete_checkin_classroom', { p_classroom_id: classId })
        },
        async removeMember(classId, userId) {
            return managementRequest('remove_checkin_member', { p_classroom_id: classId, p_user_id: userId })
        },
        async leaveClass(classId) {
            return managementRequest('leave_checkin_classroom', { p_classroom_id: classId })
        },
        async renameMember(classId, userId, name) {
            const cleanName = name.trim()
            if (!cleanName || cleanName.length > 50) throw new Error('성함을 1~50자로 입력해 주세요.')
            return managementRequest('rename_checkin_member', { p_classroom_id: classId, p_user_id: userId, p_name: cleanName })
        },
    }
}

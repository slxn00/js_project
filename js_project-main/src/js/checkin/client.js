import { checkinPrompt } from '../../../supabase/functions/_shared/checkin-prompts.js';

const messages = {
    LOGIN_REQUIRED: '로그인 후 사진 인증을 이용해 주세요.',
    MEMBERSHIP_REQUIRED: '현재 가입한 학급에서만 사진 인증을 이용할 수 있어요.',
    CHECKIN_NOT_CONFIGURED: '사진 인증이 아직 준비되지 않았어요. 관리자에게 문의해 주세요.',
};
function checkinError(error) {
    const missing = ['PGRST202', 'PGRST205', '42883', '42P01'].includes(error?.code);
    const code = missing ? 'CHECKIN_NOT_CONFIGURED' : error?.code || 'CHECKIN_UNAVAILABLE';
    const known = Object.keys(messages).find(key => String(error?.message).includes(key));
    return Object.assign(new Error(messages[known || code] || error?.message || '사진 인증 서버에 연결하지 못했어요.'), { code: known || code });
}
function normalizeState(data) {
    if (!data || typeof data !== 'object') throw new Error('출석 상태를 확인하지 못했어요.');
    if (data.attendance) {
        if (typeof data.attendance.id !== 'string' || !Number.isFinite(Date.parse(data.attendance.verifiedAt))) throw new Error('출석 기록을 확인하지 못했어요.');
        return { attendance: data.attendance, challenge: null };
    }
    let challenge = null;
    if (data.challenge) {
        const prompt = checkinPrompt(data.challenge.promptId);
        if (!prompt || typeof data.challenge.id !== 'string' || !Number.isFinite(Date.parse(data.challenge.expiresAt))) throw new Error('제시어 정보를 확인하지 못했어요.');
        challenge = { ...data.challenge, prompt };
    }
    return { attendance: null, challenge };
}

export function currentGPS() {
    return new Promise((resolve, reject) => {
        if (!globalThis.isSecureContext || !navigator.geolocation) return reject(new Error('위치 인증은 HTTPS 또는 localhost에서 사용할 수 있어요.'));
        navigator.geolocation.getCurrentPosition(position => {
            const { latitude, longitude, accuracy } = position.coords;
            resolve({ latitude, longitude, accuracy });
        }, error => {
            const reason = { 1: '위치 권한을 허용해 주세요.', 2: '현재 위치를 가져올 수 없어요.', 3: '위치 요청 시간이 초과됐어요.' };
            reject(new Error(reason[error.code] || '위치를 확인하지 못했어요.'));
        }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    });
}

export function createPhotoCheckinClient(client, getLocation = currentGPS) {
    async function request(action, values) {
        let result;
        try {
            result = await client.functions.invoke('photo-checkin', {
                body: { action, ...values }, signal: AbortSignal.timeout(60000),
            });
        } catch { throw new Error('사진 인증 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'); }
        if (result.error) {
            let detail = result.error;
            try { detail = await result.error.context.clone().json(); } catch { /* Network errors do not include a JSON response. */ }
            throw checkinError(detail);
        }
        return result.data;
    }
    return {
        async state(classroomId) {
            const { data, error } = await client.rpc('get_my_photo_checkin_state', { p_classroom_id: classroomId });
            if (error) throw checkinError(error);
            return normalizeState(data);
        },
        async begin(classroomId) {
            return normalizeState(await request('start', { classroomId, location: await getLocation() }));
        },
        async verify(challengeId, image) {
            const data = await request('verify', { challengeId, image, location: await getLocation() });
            if (!data || !['match', 'mismatch', 'uncertain'].includes(data.decision)) throw new Error('사진 판정 결과를 확인하지 못했어요.');
            if (data.decision === 'match') {
                const { attendance } = normalizeState(data);
                if (!attendance) throw new Error('출석 저장 결과를 확인하지 못했어요. 출석 상태를 다시 확인해 주세요.');
            } else if (typeof data.reason !== 'string' || !Number.isInteger(data.attemptsRemaining)) {
                throw new Error('재촬영 안내를 확인하지 못했어요.');
            }
            return data;
        },
    };
}

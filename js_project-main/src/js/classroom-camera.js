import { supabase } from './supabaseClient.js';
import { createClassroomStore } from './classroom-store.js';
import { CameraSession } from './checkin/camera-session.js';
import { createPhotoCheckinClient, attendanceMessage } from './checkin/client.js';

const $ = selector => document.querySelector(selector);
const checkin = createPhotoCheckinClient(supabase);
const camera = new CameraSession($('#camera'), navigator.mediaDevices);
const video = $('#camera');
const preview = $('#photoPreview');
const startButton = $('#startCamera');
const shutter = $('#takePhoto');
const verifyButton = $('#verifyPhoto');
const retakeButton = $('#retakePhoto');
let classId = new URLSearchParams(window.location.search).get('classroom');
let challenge = null;
let photo = null;
let rejected = false;
let stage = 'loading';
let loadVersion = 0;
let away = false;
    
function status(message, kind = '') {
    $('#cameraStatus').textContent = message;
    $('#cameraStatus').className = `camera-status ${kind}`.trim();
}
function render(next) {
    stage = next;
    $('.camera-app').dataset.stage = next;
    $('.camera-app').setAttribute('aria-busy', String(['loading', 'starting', 'verifying'].includes(next)));
    startButton.hidden = !['ready', 'starting'].includes(next);
    startButton.disabled = next === 'starting';
    startButton.textContent = next === 'starting' ? '카메라 여는 중...' : '카메라 켜기';
    shutter.hidden = next !== 'live';
    shutter.disabled = next !== 'live' || video.videoWidth === 0;
    $('#photoActions').hidden = !['captured', 'verifying'].includes(next);
    verifyButton.disabled = next === 'verifying' || rejected;
    verifyButton.textContent = next === 'verifying' ? '사진 확인 중...' : '이 사진으로 등교 인증';
    retakeButton.disabled = next === 'verifying';
    $('#restartCheckin').hidden = !['unavailable', 'expired', 'exhausted'].includes(next);
    $('#finishCheckin').hidden = next !== 'completed';
}
function completed(attendance) {
    camera.stop();
    render('completed');
    $('#promptLabel').textContent = attendance.arrivalStatus === 'late' ? '지각 등교 완료' : '등교 완료';
    $('#promptHint').textContent = '오늘 출석이 저장됐어요.';
    const time = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(attendance.submittedAt || attendance.verifiedAt));
    status(`${time} · ${attendanceMessage(attendance)}`, 'success');
}
function showPrompt(value) {
    challenge = value;
    $('#promptLabel').textContent = value.prompt.label;
    $('#promptHint').textContent = value.prompt.hint;
}
async function loadChallenge() {
    const version = ++loadVersion;
    camera.stop();
    challenge = null;
    photo = null;
    rejected = false;
    preview.hidden = true;
    preview.removeAttribute('src');
    video.hidden = true;
    $('#cameraPlaceholder').hidden = false;
    render('loading');
    $('#promptLabel').textContent = '제시어 확인 중...';
    $('#promptHint').textContent = '학교 위치와 촬영 제시어를 확인하고 있어요.';
    status('출석 상태와 촬영 제시어를 확인하고 있어요.');
    try {
        const { data, error } = await supabase.auth.getUser();
        if (error || !data.user) { window.location.replace('/login.html'); return; }
        if (!classId) {
            const joined = await createClassroomStore(supabase).getJoinedClasses();
            classId = joined[0]?.id;
        }
        if (!classId) throw new Error('학급에 입장한 뒤 사진 인증을 시작해 주세요.');
        let result = await checkin.state(classId);
        if (version !== loadVersion || away) return;
        if (result.attendance) { completed(result.attendance); return; }
        if (!result.challenge) result = await checkin.begin(classId);
        if (version !== loadVersion || away) return;
        if (result.attendance) { completed(result.attendance); return; }
        if (!result.challenge) throw new Error('촬영 제시어를 준비하지 못했어요.');
        showPrompt(result.challenge);
        if (challenge.state === 'failed' || challenge.attemptsRemaining <= 0) {
            render('exhausted');
            status('재촬영 횟수를 모두 사용했어요. 제시어 발급 후 10분이 지나면 다시 시작할 수 있어요.', 'error');
        } else if (challenge.state === 'processing') {
            render('unavailable');
            status('이전 사진을 확인하고 있어요. 잠시 후 다시 확인해 주세요.');
        } else {
            render('ready');
            status('제시어의 사물이 선명하게 보이도록 촬영해 주세요.');
        }
    } catch (error) {
        if (version !== loadVersion || away) return;
        if (error.code === 'LOGIN_REQUIRED') { window.location.replace('/login.html'); return; }
        render('unavailable');
        $('#promptLabel').textContent = error.code === 'CHECKIN_NOT_CONFIGURED' ? '사진 인증 준비 중' : '사진 인증을 시작하지 못했어요';
        $('#promptHint').textContent = error.code === 'CHECKIN_NOT_CONFIGURED' ? '선생님이 사진 인증 설정을 완료하면 이용할 수 있어요.' : '아래 안내를 확인한 뒤 다시 시도해 주세요.';
        status(error.message, 'error');
    }
}
async function startCamera() {
    if (!['ready', 'captured'].includes(stage) || !challenge) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        status('카메라는 HTTPS 또는 localhost에서 사용할 수 있어요.', 'error');
        return;
    }
    render('starting');
    status('카메라 권한을 허용해 주세요.');
    video.hidden = false;
    try {
        const ready = await camera.start();
        if (!ready || away) return;
        photo = null;
        rejected = false;
        preview.hidden = true;
        preview.removeAttribute('src');
        $('#savePhoto').removeAttribute('href');
        $('#cameraPlaceholder').hidden = true;
        render('live');
        status('제시어와 맞는 사물이 화면에 보이면 촬영 버튼을 눌러 주세요.');
    } catch (error) {
        video.hidden = true;
        render(photo ? 'captured' : 'ready');
        const messages = {
            NotAllowedError: '카메라 권한을 허용한 뒤 다시 시도해 주세요.',
            NotFoundError: '사용할 수 있는 카메라를 찾지 못했어요.',
            NotReadableError: '다른 앱에서 카메라를 사용 중일 수 있어요. 종료 후 다시 시도해 주세요.',
        };
        status(messages[error.name] || '카메라를 열지 못했어요. 다시 시도해 주세요.', 'error');
    }
}
startButton.addEventListener('click', () => { void startCamera(); });
retakeButton.addEventListener('click', () => { void startCamera(); });
video.addEventListener('canplay', () => { shutter.disabled = stage !== 'live' || !camera.stream || video.videoWidth === 0; });
shutter.addEventListener('click', () => {
    if (stage !== 'live') return;
    try {
        const frame = $('#viewfinder');
        photo = camera.capture($('#captureCanvas'), { width: frame.clientWidth, height: frame.clientHeight });
        preview.src = photo;
        preview.hidden = false;
        video.hidden = true;
        $('#savePhoto').href = photo;
        $('#savePhoto').download = `checkin-${challenge.prompt.id}-${Date.now()}.jpg`;
        render('captured');
        status('사물이 잘 보이는지 확인하고 등교 인증을 눌러 주세요.');
    } catch (error) { status(error.message, 'error'); }
});
verifyButton.addEventListener('click', async () => {
    if (stage !== 'captured' || !photo || rejected) return;
    render('verifying');
    status('학교 위치와 사진 속 사물을 확인하고 있어요.');
    try {
        const result = await checkin.verify(challenge.id, photo);
        if (away) return;
        if (result.decision === 'match') { completed(result.attendance); return; }
        rejected = true;
        render(result.attemptsRemaining > 0 ? 'captured' : 'exhausted');
        status(`${result.reason}\n${result.attemptsRemaining > 0 ? `다시 촬영해 주세요. (남은 횟수 ${result.attemptsRemaining}회)` : '재촬영 횟수를 모두 사용했어요. 잠시 후 인증을 다시 시작해 주세요.'}`, 'error');
    } catch (error) {
        if (away) return;
        // A saved attendance record remains authoritative if the HTTP response was lost.
        try {
            const result = await checkin.state(classId);
            if (away) return;
            if (result.attendance) { completed(result.attendance); return; }
        } catch { /* Keep the original actionable error. */ }
        if (away) return;
        const blocked = ['CHALLENGE_EXPIRED', 'CHALLENGE_NOT_FOUND', 'CLAIM_LOST', 'CHECKIN_IN_PROGRESS', 'MEMBERSHIP_REQUIRED', 'ATTEMPTS_EXHAUSTED', 'DAILY_LIMIT'];
        render(blocked.includes(error.code) ? 'unavailable' : 'captured');
        status(error.message, 'error');
    }
});
$('#restartCheckin').addEventListener('click', () => { void loadChallenge(); });
function pause() {
    const active = ['live', 'starting'].includes(stage);
    camera.stop();
    video.hidden = true;
    if (active) {
        render(photo ? 'captured' : 'ready');
        status('카메라를 일시 정지했어요. 다시 켜서 촬영해 주세요.');
    }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('pagehide', () => { away = true; ++loadVersion; pause(); });
window.addEventListener('pageshow', event => { if (event.persisted) { away = false; void loadChallenge(); } });
supabase.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') { away = true; ++loadVersion; camera.stop(); window.location.replace('/login.html'); }
});
void loadChallenge();

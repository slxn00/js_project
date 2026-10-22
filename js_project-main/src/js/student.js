import { supabase } from './supabaseClient.js';
import { createClassroomStore, classroomError } from './classroom-store.js';

const $ = (selector) => document.querySelector(selector);
const classrooms = createClassroomStore(supabase);
const actionButton = $('#studentAction');
const status = $('#studentStatus');
const classCard = $('#studentClassCard');
const joinDialog = $('#studentJoinDialog');
const joinForm = $('#studentJoinForm');
const joinError = $('#joinError');
let joinedClasses = [];
let busy = false;
let user = null;
let ready = false;

function showStatus(message, kind = '') {
  status.textContent = message;
  status.className = `student-status ${kind}`.trim();
}

function setActionState() {
  actionButton.disabled = !ready || busy;
  actionButton.textContent = joinedClasses.length ? '등교했어요' : '학급 입장';
}

function renderClasses() {
  classCard.replaceChildren();
  if (!joinedClasses.length) {
    const title = document.createElement('strong');
    title.textContent = '아직 가입한 학급이 없어요.';
    const detail = document.createElement('p');
    detail.textContent = '하단의 학급 입장 버튼을 눌러 학급 참여 코드를 입력하세요.';
    classCard.append(title, detail);
  } else {
    const school = joinedClasses[0];
    const heading = document.createElement('h3');
    heading.textContent = school.className;
    const schoolName = document.createElement('p');
    schoolName.textContent = school.school?.name || '학교 정보 없음';
    const codeLabel = document.createElement('span');
    codeLabel.className = 'code-label';
    codeLabel.textContent = '학급 참여 코드';
    const code = document.createElement('strong');
    code.className = 'class-code';
    code.textContent = school.code;
    const leave = document.createElement('button');
    leave.type = 'button';
    leave.className = 'leave-button';
    leave.textContent = '학급 탈퇴';
    leave.addEventListener('click', () => leaveClass(school));
    classCard.append(heading, schoolName, codeLabel, code, leave);
  }
  setActionState();
}

async function loadStudent() {
  ready = false;
  setActionState();
  try {
    const auth = await supabase.auth.getUser();
    if (auth.error || !auth.data.user) {
      window.location.replace('/login.html');
      return;
    }
    user = auth.data.user;
    const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || '학생';
    $('#studentName').textContent = name;
    $('#studentEmail').textContent = user.email || '';
    $('#studentJoinName').value = name;
    const owned = await classrooms.getOwnedClasses();
    if (owned.length) {
      window.location.replace('/admin.html');
      return;
    }
    joinedClasses = await classrooms.getJoinedClasses();
    ready = true;
    renderClasses();
    showStatus('');
  } catch (error) {
    showStatus(`학급 정보를 불러오지 못했어요: ${error.message}`, 'error');
    classCard.textContent = '데이터베이스 연결을 확인해 주세요.';
  }
}

function currentGPS() {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext || !navigator.geolocation) {
      reject(new Error('위치 인증은 HTTPS 또는 localhost에서만 사용할 수 있어요.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position.coords),
      (error) => {
        const messages = { 1: '위치 권한을 허용해 주세요.', 2: '현재 위치를 가져올 수 없어요.', 3: '위치 요청 시간이 초과됐어요.' };
        reject(new Error(messages[error.code] || '위치를 확인하지 못했어요.'));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

async function verifyAttendance() {
  if (!joinedClasses.length || busy) return;
  busy = true;
  actionButton.disabled = true;
  actionButton.textContent = '위치 확인 중...';
  showStatus('현재 GPS 위치를 가져오는 중이에요.');
  try {
    const coords = await currentGPS();
    showStatus('관리자가 설정한 학교 위치와 거리를 비교하고 있어요.');
    const { data, error } = await supabase.rpc('verify_checkin_location', {
      p_classroom_id: joinedClasses[0].id,
      p_latitude: coords.latitude,
      p_longitude: coords.longitude,
      p_accuracy: coords.accuracy,
    });
    if (error) throw classroomError(error);
    if (!data || typeof data.success !== 'boolean') throw new Error('위치 인증 결과를 확인할 수 없어요.');
    if (data.retry) {
      showStatus(data.message || '위치 정확도를 확인하고 다시 시도해 주세요.', 'error');
    } else if (data.success) {
      showStatus(`✅ 위치 인증 성공! ${data.schoolName || '학교'}에서 약 ${data.distanceMeters}m 떨어져 있어요. (설정 반경 ${data.radiusMeters}m)`, 'success');
    } else {
      showStatus(`❌ 인증 범위 밖이에요. 학교에서 약 ${data.distanceMeters}m 떨어져 있어요. (설정 반경 ${data.radiusMeters}m)`, 'error');
    }
  } catch (error) {
    showStatus(error.message, 'error');
  } finally {
    busy = false;
    setActionState();
  }
}

async function leaveClass(item) {
  if (busy || !window.confirm(`${item.className} 학급에서 탈퇴할까요?`)) return;
  busy = true;
  actionButton.disabled = true;
  try {
    await classrooms.leaveClass(item.id);
    joinedClasses = joinedClasses.filter((c) => c.id !== item.id);
    ready = true;
    renderClasses();
    showStatus('학급에서 탈퇴했어요.');
  } catch (error) {
    showStatus(error.message, 'error');
  } finally {
    busy = false;
    setActionState();
  }
}

actionButton.addEventListener('click', () => {
  if (busy || !ready) return;
  if (joinedClasses.length) {
    void verifyAttendance();
  } else {
    joinError.textContent = '';
    codeInputs.forEach(input => { input.value = ''; });
    joinDialog.showModal();
    $('#studentJoinName').focus();
  }
});

$('#closeJoinDialog').addEventListener('click', () => joinDialog.close());
joinDialog.addEventListener('click', (event) => {
  if (event.target === joinDialog) joinDialog.close();
});

// 학급코드: 소문자도 허용해 자동 대문자로 바꾸고 한글은 제거합니다.
// 5칸 입력 및 전체 코드 붙여넣기를 지원합니다.
const codeInputs = [...document.querySelectorAll('.join-code-digit')];
const normalizeCode = (value) => String(value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

function fillCode(value, startingAt = 0) {
  const clean = normalizeCode(value);
  if (!clean) return;
  const start = clean.length === codeInputs.length ? 0 : startingAt;
  clean.split('').forEach((char, index) => {
    if (codeInputs[start + index]) codeInputs[start + index].value = char;
  });
  codeInputs[Math.min(start + clean.length, codeInputs.length - 1)].focus();
}

codeInputs.forEach((input, index) => {
  input.addEventListener('focus', () => input.select());
  input.addEventListener('input', () => {
    if (input.isComposing) return;
    const clean = normalizeCode(input.value);
    input.value = clean.slice(0, 1);
    if (clean.length > 1) fillCode(clean, index);
    else if (clean && index < codeInputs.length - 1) codeInputs[index + 1].focus();
    joinError.textContent = '';
  });
  input.addEventListener('compositionend', () => {
    // 한글 IME 입력도 정리 (영문/숫자만 유지)
    input.value = normalizeCode(input.value).slice(0, 1);
  });
  input.addEventListener('paste', (event) => {
    event.preventDefault();
    fillCode(event.clipboardData.getData('text'), index);
    joinError.textContent = '';
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Backspace' && !input.value && index > 0) {
      event.preventDefault();
      codeInputs[index - 1].value = '';
      codeInputs[index - 1].focus();
    } else if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      codeInputs[index - 1].focus();
    } else if (event.key === 'ArrowRight' && index < codeInputs.length - 1) {
      event.preventDefault();
      codeInputs[index + 1].focus();
    }
  });
});

joinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  const name = $('#studentJoinName').value.trim();
  const code = codeInputs.map(input => input.value).join('').toUpperCase();
  if (!name || name.length > 50 || !/^[A-Z0-9]{5}$/.test(code)) {
    joinError.textContent = '성함과 5자리 학급 참여 코드를 정확히 입력해 주세요.';
    return;
  }
  busy = true;
  $('#joinSubmit').disabled = true;
  $('#joinSubmit').textContent = '입장 중...';
  try {
    await classrooms.joinClass({ name, code });
    joinDialog.close();
    joinedClasses = await classrooms.getJoinedClasses();
    renderClasses();
    showStatus('학급 입장이 완료됐어요.', 'success');
  } catch (error) {
    joinError.textContent = error.message;
  } finally {
    busy = false;
    $('#joinSubmit').disabled = false;
    $('#joinSubmit').textContent = '학급 입장하기';
    setActionState();
  }
});

$('#studentLogout').addEventListener('click', async () => {
  if (busy) return;
  const { error } = await supabase.auth.signOut();
  if (error) showStatus('로그아웃에 실패했어요.', 'error');
  else window.location.replace('/login.html');
});

$('#todayDate').textContent = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'full' }).format(new Date());
void loadStudent();

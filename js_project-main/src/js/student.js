import { supabase } from './supabaseClient.js';
import { createClassroomStore, classroomError } from './classroom-store.js';
import { createCalendarStore, eventTiming, eventRange, todayISO } from './calendar.js';

const $ = (selector) => document.querySelector(selector);
const classrooms = createClassroomStore(supabase);
const calendar = createCalendarStore(supabase);
const clone = id => document.getElementById(id).content.firstElementChild.cloneNode(true);
const scheduleStatus = $('#scheduleStatus');
const scheduleList = $('#studentScheduleList');
const refreshSchedule = $('#refreshSchedule');
const includePast = $('#includePastEvents');
let scheduleRequest = 0;
let scheduleLoading = false;
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
  const school = joinedClasses[0];
  const content = clone(school ? 'studentClassTemplate' : 'studentClassEmptyTemplate');
  if (school) {
    content.querySelector('h3').textContent = school.className;
    content.querySelector('p').textContent = school.school?.name || '학교 정보 없음';
    content.querySelector('.class-code').textContent = school.code;
    content.querySelector('button').addEventListener('click', () => leaveClass(school));
  }
  classCard.replaceChildren(content);
  scheduleList.replaceChildren();
  void loadSchedule();
  setActionState();
}

async function loadSchedule({ silent = false } = {}) {
  const token = ++scheduleRequest;
  const school = joinedClasses[0];
  const today = todayISO();
  $('#todayDate').textContent = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'full', timeZone: 'Asia/Seoul' }).format(new Date());
  $('#scheduleSummary').textContent = includePast.checked ? '지난 일정까지 모두 표시' : '예정·진행 중인 일정';
  refreshSchedule.disabled = true;
  if (!school) {
    scheduleList.replaceChildren();
    scheduleLoading = false;
    scheduleList.setAttribute('aria-busy', 'false');
    scheduleStatus.classList.remove('error');
    scheduleStatus.textContent = '학급에 입장하면 선생님이 등록한 학사일정을 볼 수 있어요.';
    return;
  }
  scheduleLoading = true;
  scheduleList.setAttribute('aria-busy', 'true');
  scheduleStatus.classList.remove('error');
  if (!silent) scheduleStatus.textContent = '학사일정을 불러오고 있어요...';
  try {
    const events = await calendar.getEvents(school.id, includePast.checked ? {} : { start: today });
    if (token !== scheduleRequest) return;
    const rows = [];
    for (const event of events) {
      const row = clone('studentEventTemplate');
      const timing = eventTiming(event, today);
      row.dataset.state = timing.state;
      row.querySelector('h3').textContent = event.name;
      row.querySelector('.event-date').textContent = eventRange(event);
      const description = row.querySelector('.event-description');
      description.textContent = event.description;
      description.hidden = !event.description;
      row.querySelector('.dday-badge').textContent = timing.label;
      row.querySelector('.event-state').textContent = {
        upcoming: '시작일까지', today: '오늘 시작', ongoing: '기간 일정', past: '종료된 일정',
      }[timing.state];
      rows.push(row);
    }
    scheduleList.replaceChildren(...rows);
    scheduleStatus.textContent = events.length ? `${school.className} · ${events.length}개의 일정` :
      includePast.checked ? '등록된 학사일정이 아직 없어요.' : '예정·진행 중인 학사일정이 없어요.';
  } catch (error) {
    if (token !== scheduleRequest) return;
    scheduleList.replaceChildren();
    scheduleStatus.classList.add('error');
    scheduleStatus.textContent = `${error.message} 새로고침으로 다시 시도해 주세요.`;
  } finally {
    if (token === scheduleRequest) {
      scheduleLoading = false;
      refreshSchedule.disabled = false;
      scheduleList.setAttribute('aria-busy', 'false');
    }
  }
}

refreshSchedule.addEventListener('click', () => { void loadSchedule(); });
includePast.addEventListener('change', () => { void loadSchedule(); });
window.addEventListener('focus', () => { if (ready) void loadSchedule({ silent: true }); });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && ready) void loadSchedule({ silent: true });
});
// 다른 기기에서 등록·삭제한 일정과 자정 이후의 D-day를 갱신합니다.
const scheduleTimer = window.setInterval(() => {
  if (!document.hidden && ready && !scheduleLoading) void loadSchedule({ silent: true });
}, 30000);
window.addEventListener('pagehide', event => {
  if (!event.persisted) window.clearInterval(scheduleTimer);
});
supabase.auth.onAuthStateChange(event => {
  if (event === 'SIGNED_OUT') {
    joinedClasses = [];
    ready = false;
    renderClasses();
    window.location.replace('/login.html');
  }
});

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
    scheduleStatus.textContent = '학급 정보를 확인한 뒤 학사일정을 불러올 수 있어요.';
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

void loadStudent();

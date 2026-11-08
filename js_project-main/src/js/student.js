import { supabase } from './supabaseClient.js';
import { createClassroomStore } from './classroom-store.js';
import { createCalendarStore, eventTiming, eventRange, todayISO } from './calendar.js';
import { createPhotoCheckinClient, attendanceMessage } from './checkin/client.js';

const $ = (selector) => document.querySelector(selector);
const classrooms = createClassroomStore(supabase);
const calendar = createCalendarStore(supabase);
const checkin = createPhotoCheckinClient(supabase);
const clone = id => document.getElementById(id).content.firstElementChild.cloneNode(true);
const scheduleStatus = $('#scheduleStatus');
const scheduleList = $('#studentScheduleList');
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
let attendance = null;
let attendanceDay = '';

function showStatus(message, kind = '') {
  status.textContent = message;
  status.className = `student-status ${kind}`.trim();
}

function setActionState() {
  actionButton.disabled = !ready || busy || Boolean(attendance);
  actionButton.textContent = attendance ? `오늘 등교 완료${attendance.arrivalStatus === 'late' ? ' · 지각' : ''}` : joinedClasses.length ? '등교했어요' : '학급 입장';
}

function showScheduleStatus(message, error = false) {
  scheduleStatus.textContent = message;
  scheduleStatus.hidden = !message;
  scheduleStatus.classList.toggle('error', error);
}

function renderClasses() {
  attendance = null;
  attendanceDay = '';
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

async function refreshAttendance() {
  const classId = joinedClasses[0]?.id;
  const day = todayISO();
  if (!ready || busy || !classId) return;
  try {
    const result = await checkin.state(classId);
    if (!ready || busy || classId !== joinedClasses[0]?.id || day !== todayISO()) return;
    attendance = result.attendance;
    attendanceDay = day;
    showStatus(attendance ? attendanceMessage(attendance) : '', attendance ? 'success' : '');
    setActionState();
  } catch (error) {
    if (ready && !busy && classId === joinedClasses[0]?.id) showStatus(error.message, 'error');
  }
}

async function loadSchedule({ silent = false } = {}) {
  const token = ++scheduleRequest;
  const school = joinedClasses[0];
  const today = todayISO();
  $('#todayDate').textContent = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'full', timeZone: 'Asia/Seoul' }).format(new Date());
  if (!school) {
    scheduleList.replaceChildren();
    scheduleLoading = false;
    scheduleList.setAttribute('aria-busy', 'false');
    showScheduleStatus('학급에 입장하면 선생님이 등록한 학사일정을 볼 수 있어요.');
    return;
  }
  scheduleLoading = true;
  scheduleList.setAttribute('aria-busy', 'true');
  if (!silent) showScheduleStatus('학사일정을 불러오고 있어요...');
  try {
    const events = await calendar.getEvents(school.id, { start: today });
    if (token !== scheduleRequest) return;
    const rows = events.map(event => {
      const row = clone('studentEventTemplate');
      const timing = eventTiming(event, today);
      row.dataset.state = timing.state;
      row.querySelector('h3').textContent = event.name;
      row.querySelector('.event-date').textContent = eventRange(event);
      const description = row.querySelector('.event-description');
      description.textContent = event.description;
      description.hidden = !event.description;
      row.querySelector('.dday-badge').textContent = timing.label;
      return row;
    });
    scheduleList.replaceChildren(...rows);
    showScheduleStatus(events.length ? '' : '등록된 학사일정이 아직 없어요.');
  } catch (error) {
    if (token !== scheduleRequest) return;
    scheduleList.replaceChildren();
    showScheduleStatus(`${error.message} 잠시 후 자동으로 다시 확인할게요.`, true);
  } finally {
    if (token === scheduleRequest) {
      scheduleLoading = false;
      scheduleList.setAttribute('aria-busy', 'false');
    }
  }
}

function refreshScreen() {
  if (!ready) return;
  void loadSchedule({ silent: true });
  void refreshAttendance();
}
window.addEventListener('focus', refreshScreen);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshScreen();
});
// 다른 기기에서 등록·삭제한 일정과 자정 이후의 D-day를 갱신합니다.
const scheduleTimer = window.setInterval(() => {
  if (!document.hidden && ready && !scheduleLoading) void loadSchedule({ silent: true });
  if (!document.hidden && attendanceDay && attendanceDay !== todayISO()) void refreshAttendance();
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
    void refreshAttendance();
  } catch (error) {
    showStatus(`학급 정보를 불러오지 못했어요: ${error.message}`, 'error');
    classCard.textContent = '데이터베이스 연결을 확인해 주세요.';
    showScheduleStatus('학급 정보를 확인한 뒤 학사일정을 불러올 수 있어요.');
  }
}

async function verifyAttendance() {
  if (!joinedClasses.length || busy || attendance) return;
  const classId = joinedClasses[0].id;
  busy = true;
  setActionState();
  actionButton.textContent = '인증 준비 중...';
  showStatus('학교 위치를 확인하고 촬영 제시어를 준비하고 있어요.');
  try {
    const result = await checkin.begin(classId);
    if (!ready || classId !== joinedClasses[0]?.id) return;
    if (result.attendance) {
      attendance = result.attendance;
      attendanceDay = todayISO();
      showStatus(attendanceMessage(attendance), 'success');
    } else if (result.challenge) {
      window.location.assign(`/camera.html?classroom=${encodeURIComponent(classId)}`);
    } else {
      throw new Error('촬영 제시어를 준비하지 못했어요. 다시 시도해 주세요.');
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
  $('#joinSubmit').textContent = '로딩 중 ..';
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

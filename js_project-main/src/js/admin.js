
import { supabase } from "./supabaseClient.js";
import { redirectAuthCallbackError } from "./auth-callback.js";
import { createClassroomStore } from './classroom-store.js';
import { createClassroomDialog } from './classroom-dialog.js';

const hasAuthCallbackError = redirectAuthCallbackError();

const $ = (selector) => document.querySelector(selector);

const tabs = document.querySelectorAll(".tab");

const panels = {
  classes: $("#classesPanel"),
  members: $("#membersPanel"),
  board: $("#boardPanel"),
};
const classrooms = createClassroomStore(supabase);
const manageClassroom = createClassroomDialog($('#classroomManageDialog'));
let accountUserId = null;
let ownedClasses = [];
let joinedClasses = [];
let joinedStatus = "입장한 클래스를 불러오고 있어요.";
let joinedRequest = 0;
let ownedClassesLoaded = false;
let joinedClassesLoaded = false;
let activeClassId = null;
let memberRequest = 0;
let creatingClass = false;

function closeMemberMenus(target, restoreFocus = false) {
  document.querySelectorAll('.member-actions[open]').forEach(menu => {
    if (target && menu.contains(target)) return;
    menu.open = false;
    if (restoreFocus) menu.querySelector('summary').focus();
  });
}

document.addEventListener('click', event => closeMemberMenus(event.target));
document.addEventListener('focusin', event => closeMemberMenus(event.target));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeMemberMenus(null, true);
});

// 1. 로그인한 사용자 정보
async function loadTeacher() {
  try {
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      $("#teacherName").textContent = "사용자";
      $("#teacherEmail").textContent = "로그인이 필요합니다.";
      $("#accountEmail").textContent = "로그인된 계정이 없습니다.";
      return;
    }

    const user = data.user;
    accountUserId = user.id;

    const name =
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      user.email?.split("@")[0] ||
      "사용자";

    $("#teacherName").textContent = name;
    $("#teacherEmail").textContent = user.email || "";
    $("#accountEmail").textContent = user.email || "";

  } catch (error) {
    console.error("사용자 정보 조회 실패:", error);
    $("#teacherEmail").textContent = "계정 조회 실패";
  }
}

// 2. 탭 전환
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const selected = tab.dataset.tab;

    tabs.forEach((item) => {
      const active = item === tab;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });

    Object.entries(panels).forEach(([name, panel]) => {
      panel.hidden = name !== selected;
    });
    if (selected === 'members') loadMembers();
    if (selected === 'classes') loadJoinedClasses();
  });
});

const createClassModal =
  document.querySelector("#createClassModal");

const createClassFrame =
  document.querySelector("#createClassFrame");

function openCreateClass() {
  if (!ownedClassesLoaded || !joinedClassesLoaded || ownedClasses.length || joinedClasses.length) return;
  createClassFrame.src = "/create-class.html?embed=1";
  createClassModal.hidden = false;

  // 모달을 연 동안 뒤쪽 페이지 스크롤 방지
  document.body.style.overflow = "hidden";
}

function closeCreateClass() {
  createClassModal.hidden = true;
  createClassFrame.src = "about:blank";

  document.body.style.overflow = "";
}

// 내부 학급 생성 화면에서 닫기 요청 받기
window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.source !== createClassFrame.contentWindow) return;

  if (event.data?.type === "CLOSE_CREATE_CLASS") {
    closeCreateClass();
  }
});

// 4. 계정 설정
const settingsModal = $("#settingsModal");

$("#settingsButton").addEventListener("click", () => {
  settingsModal.hidden = false;
  $("#settingsStatus").textContent = "";
});

$("#closeSettings").addEventListener("click", () => {
  settingsModal.hidden = true;
});

settingsModal.addEventListener("click", (event) => {
  if (event.target === settingsModal) {
    settingsModal.hidden = true;
  }
});

// 5. 로그아웃
$("#logoutButton").addEventListener("click", async () => {
  const button = $("#logoutButton");
  button.disabled = true;

  const { error } = await supabase.auth.signOut();

  if (error) {
    $("#settingsStatus").textContent =
      "로그아웃에 실패했습니다.";
    button.disabled = false;
    return;
  }

  window.location.href = "/login.html";
});

// 초기 실행
if (!hasAuthCallbackError) loadTeacher();

// ========================================
// 학급 코드 생성 및 임시 학급 관리
// ========================================

const CODE_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

// 영문 대문자 + 숫자가 포함된 5자리 코드
function generateClassCode(existingCodes) {
  function randomCharacter() {
    const buffer = new Uint8Array(1);
    let value;

    // 36개 문자에 균등하게 분포하도록 처리
    do {
      crypto.getRandomValues(buffer);
      value = buffer[0];
    } while (value >= 252);

    return CODE_CHARS[value % CODE_CHARS.length];
  }

  for (let attempt = 0; attempt < 1000; attempt++) {
    let code = "";

    for (let i = 0; i < 5; i++) {
      code += randomCharacter();
    }

    const hasLetter = /[A-Z]/.test(code);
    const hasNumber = /[0-9]/.test(code);

    if (
      hasLetter &&
      hasNumber &&
      !existingCodes.has(code)
    ) {
      return code;
    }
  }

  throw new Error("사용 가능한 학급 코드를 생성하지 못했습니다.");
}

// 현재 로그인 사용자의 임시 학급 데이터
function storageKey(userId) {
  return `teacherClasses:${userId}`;
}

function getSavedClasses(userId) {
  try {
    const saved = JSON.parse(
      localStorage.getItem(storageKey(userId)) || "[]"
    );

    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

// 입장한 학급과 직접 관리하는 학급을 각각 표시한다.
function renderClasses(classes) {
  ownedClasses = classes;
  activeClassId = classes[0]?.id || null;
  renderClassPanel();
  renderMembersPanel();
}

function classCard(item, managed = false) {
  const card = document.createElement('article');
  card.className = 'created-class-card';
  const name = document.createElement('h3');
  name.textContent = item.className;
  const school = document.createElement('p');
  school.textContent = item.school.name;
  const code = document.createElement('strong');
  code.className = 'class-code';
  code.textContent = item.code;
  const label = document.createElement('small');
  label.textContent = '학급 참여코드';
  card.append(name, school, code, label);
  if (managed) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'delete-class-button';
    remove.textContent = '학급 삭제';
    remove.setAttribute('aria-label', `${item.className} 학급 삭제`);
    remove.addEventListener('click', () => manageClassroom({
      title: '학급 삭제',
      description: `${item.className} 학급을 삭제할까요? 학생들의 학급 소속도 해제됩니다.`,
      submit: '학급 삭제',
      action: async () => {
        await classrooms.deleteClass(item.id);
        // Clear this browser's legacy backup; the DB tombstone also protects other browsers.
        if (accountUserId) {
          try { localStorage.setItem(storageKey(accountUserId), JSON.stringify(getSavedClasses(accountUserId).filter(saved => saved.id !== item.id))); }
          catch { /* The database remains the source of truth when local storage is blocked. */ }
        }
        joinedClasses = joinedClasses.filter(joined => joined.id !== item.id);
        renderClasses(ownedClasses.filter(owned => owned.id !== item.id));
        $('#joinClassSummary').hidden = true;
        await Promise.all([initializeSavedClasses(), loadJoinedClasses()]);
      },
    }));
    card.append(remove);
  } else {
    const leave = document.createElement('button');
    leave.type = 'button';
    leave.className = 'delete-class-button';
    leave.textContent = '학급 탈퇴';
    leave.setAttribute('aria-label', `${item.className} 학급 탈퇴`);
    leave.addEventListener('click', () => manageClassroom({
      title: '학급 탈퇴',
      description: `${item.className} 학급에서 탈퇴할까요? 탈퇴하면 다른 학급에 입장할 수 있어요.`,
      submit: '탈퇴하기',
      action: async () => {
        await classrooms.leaveClass(item.id);
        joinedRequest++;
        joinedClasses = joinedClasses.filter(joined => joined.id !== item.id);
        joinedStatus = joinedClasses.length ? '' : '아직 입장한 클래스가 없어요. 학급코드로 입장해 주세요.';
        renderClassPanel();
        const summary = $('#joinClassSummary');
        summary.textContent = '학급에서 탈퇴했어요.';
        summary.classList.remove('is-error');
        summary.hidden = false;
        await Promise.all([initializeSavedClasses(), loadJoinedClasses()]);
      },
    }));
    card.append(leave);
  }
  return card;
}

function renderClassPanel() {
  updateClassroomRole();
  const panel = panels.classes;
  panel.replaceChildren();
  const title = document.createElement('h2');
  title.className = 'class-section-title';
  title.textContent = '내 클래스';
  panel.append(title);
  if (joinedClasses.length) {
    const list = document.createElement('div');
    list.className = 'created-classes';
    list.id = 'joinedClassesList';
    joinedClasses.forEach(item => list.append(classCard(item)));
    panel.append(list);
  }
  const status = document.createElement('p');
  status.id = 'joinedClassesStatus';
  status.className = 'class-list-status';
  status.setAttribute('role', 'status');
  status.textContent = ownedClasses.length && joinedClassesLoaded ? '' : joinedStatus;
  status.hidden = !status.textContent;
  panel.append(status);
  if (ownedClasses.length) {
    const heading = document.createElement('h2');
    heading.className = 'class-section-title';
    heading.textContent = '관리 중인 클래스';
    const list = document.createElement('div');
    list.className = 'created-classes';
    ownedClasses.forEach(item => list.append(classCard(item, true)));
    if (joinedClasses.length) panel.append(heading);
    panel.append(list);
  }
  if (ownedClassesLoaded && joinedClassesLoaded && !ownedClasses.length && !joinedClasses.length) {
    const addButton = document.createElement('button');
    addButton.className = 'create-class-button';
    addButton.type = 'button';
    addButton.textContent = '+ 새 학급 생성하기';
    addButton.addEventListener('click', openCreateClass);
    panel.append(addButton);
  }
}

function updateClassroomRole() {
  const teacher = ownedClasses.length > 0;
  const student = !teacher && joinedClasses.length > 0;
  $('#accountRole').textContent = teacher ? '선생님' : student ? '학생' : ownedClassesLoaded && joinedClassesLoaded ? '학급 미소속' : '학급 확인 중';
  const memberTab = document.querySelector('[data-tab="members"]');
  memberTab.hidden = !teacher;
  document.querySelector('.tabs').style.gridTemplateColumns = `repeat(${teacher ? 3 : 2}, 1fr)`;
  const actionButton = $('#joinClassButton');
  actionButton.disabled = !(ownedClassesLoaded && joinedClassesLoaded);
  actionButton.dataset.action = teacher ? 'write-post' : 'create-class';
  actionButton.dataset.hasClass = String(teacher || student);
  actionButton.textContent = teacher ? '게시글 작성하기' : '학급 생성하기';
  if (student && ownedClassesLoaded && joinedClassesLoaded) {
    window.location.replace('/student.html');
    return;
  }
  if (!teacher && !panels.members.hidden) {
    document.querySelector('[data-tab="classes"]').click();
  }
}

// 관리자 하단 버튼: 학급이 없으면 생성, 관리 학급이 있으면 게시판 안내.
$('#joinClassButton').addEventListener('click', () => {
  const action = $('#joinClassButton').dataset.action;
  if (action === 'create-class') {
    openCreateClass();
  } else if (action === 'write-post') {
    document.querySelector('[data-tab="board"]').click();
    const summary = $('#joinClassSummary');
    summary.hidden = false;
    summary.classList.remove('is-error');
    summary.textContent = '게시글 작성 기능은 다음 단계에서 연결할 예정입니다.';
  }
});

async function loadJoinedClasses() {
  const request = ++joinedRequest;
  try {
    const classes = await classrooms.getJoinedClasses();
    if (request !== joinedRequest) return;
    joinedClasses = classes;
    joinedClassesLoaded = true;
    joinedStatus = classes.length ? '' : '아직 입장한 클래스가 없어요. 학급코드로 입장해 주세요.';
  } catch (error) {
    if (request !== joinedRequest) return;
    joinedStatus = error.message;
  }
  renderClassPanel();
}

function renderMembersPanel() {
  memberRequest++;
  const panel = panels.members;
  panel.replaceChildren();
  const wrapper = document.createElement('section');
  wrapper.className = 'members-view';
  const heading = document.createElement('div');
  heading.className = 'members-heading';
  const title = document.createElement('h2');
  title.textContent = '학급 멤버';
  const count = document.createElement('span');
  count.id = 'memberCount';
  count.textContent = '0명';
  heading.append(title, count);
  wrapper.append(heading);

  if (ownedClasses.length) {
    const refresh = document.createElement('button');
    refresh.id = 'refreshMembers';
    refresh.className = 'refresh-members';
    refresh.type = 'button';
    refresh.textContent = '새로고침';
    refresh.addEventListener('click', loadMembers);
    wrapper.append(refresh);
  }

  const status = document.createElement('p');
  status.id = 'membersStatus';
  status.className = 'members-status';
  status.setAttribute('role', 'status');
  status.textContent = ownedClasses.length ? '멤버를 불러오고 있어요.' : '학생 관리는 해당 학급의 선생님만 할 수 있어요.';
  const list = document.createElement('ul');
  list.id = 'membersList';
  list.className = 'members-list';
  wrapper.append(status, list);
  panel.append(wrapper);
  if (ownedClasses.length) loadMembers();
}

async function loadMembers() {
  const id = activeClassId;
  const request = ++memberRequest;
  const status = $('#membersStatus');
  const list = $('#membersList');
  if (!status || !list || !id) return;
  status.textContent = '멤버를 불러오고 있어요.';
  $('#memberCount').textContent = '—';
  $('#refreshMembers').disabled = true;
  list.replaceChildren();
  try {
    const members = await classrooms.getMembers(id);
    if (request !== memberRequest || id !== activeClassId) return;
    $('#memberCount').textContent = `${members.length}명`;
    status.textContent = members.length ? '학급에 입장한 사용자입니다.' : '아직 입장한 멤버가 없어요.';
    members.forEach(member => {
      const row = document.createElement('li');
      row.className = 'member-row';
      const avatar = document.createElement('span');
      avatar.className = 'member-avatar';
      avatar.textContent = [...member.name][0] || '•';
      avatar.setAttribute('aria-hidden', 'true');
      const details = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = member.name;
      const time = document.createElement('small');
      time.textContent = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(member.joinedAt)) + ' 입장';
      details.append(name, time);
      const actions = document.createElement('details');
      actions.className = 'member-actions';
      actions.setAttribute('name', 'member-actions');
      const toggle = document.createElement('summary');
      toggle.className = 'member-menu-toggle';
      toggle.setAttribute('aria-label', `${member.name} 학생 더 보기`);
      toggle.title = '학생 관리';
      toggle.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>';
      const menu = document.createElement('div');
      menu.className = 'member-menu';
      const openManagement = options => {
        actions.open = false;
        toggle.focus();
        manageClassroom(options);
      };
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 4 4 4M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15z"/></svg><span>이름 수정</span>';
      edit.setAttribute('aria-label', `${member.name} 이름 수정`);
      edit.addEventListener('click', () => openManagement({
        title: '학생 이름 수정', description: '이 학급의 멤버 목록에 표시할 이름을 입력해 주세요.',
        name: member.name, submit: '저장',
        action: async name => { await classrooms.renameMember(id, member.userId, name); await loadMembers(); },
      }));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/></svg><span>학생 삭제</span>';
      remove.className = 'remove-member-button';
      remove.setAttribute('aria-label', `${member.name} 학생 삭제`);
      remove.addEventListener('click', () => openManagement({
        title: '학생 삭제', description: `${member.name} 학생을 이 학급에서 제외할까요? 학생 계정은 유지됩니다.`, submit: '학생 삭제',
        action: async () => { await classrooms.removeMember(id, member.userId); await loadMembers(); },
      }));
      menu.append(edit, remove);
      actions.append(toggle, menu);
      row.append(avatar, details, actions);
      list.append(row);
    });
  } catch (error) {
    if (request !== memberRequest || id !== activeClassId) return;
    status.textContent = error.message;
    $('#memberCount').textContent = '확인 필요';
  } finally {
    if (request === memberRequest && $('#refreshMembers')) $('#refreshMembers').disabled = false;
  }
}

window.addEventListener('classroom:joined', (event) => {
  const membership = event.detail;
  joinedClasses = [
    { id: membership.classId, className: membership.className, school: { name: membership.schoolName }, code: membership.code, joinedAt: membership.joinedAt },
    ...joinedClasses.filter(item => item.id !== membership.classId),
  ];
  joinedStatus = '';
  renderClassPanel();
  document.querySelector('[data-tab="classes"]').click();
});

// 학급 생성 메시지 수신
window.addEventListener("message", async (event) => {
  if (event.origin !== window.location.origin) return;

  const frame = document.querySelector("#createClassFrame");

  if (!frame || event.source !== frame.contentWindow) {
    return;
  }

  if (event.data?.type !== "CREATE_CLASS_REQUEST") {
    return;
  }
  if (creatingClass) return;
  creatingClass = true;

  try {
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      throw new Error("로그인이 필요합니다.");
    }

    const incoming = event.data.classData;

    if (
      typeof incoming?.className !== "string" ||
      !incoming.className.trim() ||
      incoming.className.length > 50 ||
      typeof incoming.school?.name !== "string" ||
      !incoming.school.name.trim() ||
      !Number.isFinite(incoming.school.latitude) ||
      !Number.isFinite(incoming.school.longitude) ||
      !Number.isFinite(incoming.radiusMeters) ||
      incoming.radiusMeters < 50 ||
      incoming.radiusMeters > 500
    ) {
      throw new Error("학급 설정이 올바르지 않습니다.");
    }

    const userId = data.user.id;

    const classes = await classrooms.getOwnedClasses(getSavedClasses(userId));

    const existingCodes = new Set(
      classes.map((item) => item.code)
    );

    const code = generateClassCode(existingCodes);

    const newClass = {
      id: crypto.randomUUID(),
      className: incoming.className.trim(),
      school: incoming.school,
      radiusMeters: incoming.radiusMeters,
      code,
      createdAt: new Date().toISOString(),
    };

    const saved = await classrooms.createClass(newClass);
    classes.push(saved);

    // 화면 갱신
    renderClasses(classes);

    // 멤버 탭으로 전환
    document.querySelector(
      '[data-tab="members"]'
    )?.click();

    // 모달 닫기
    closeCreateClass();

  } catch (error) {
    console.error("학급 생성 실패:", error);
    frame.contentWindow?.postMessage({ type: 'CREATE_CLASS_ERROR', message: error.message || '학급 생성에 실패했습니다.' }, window.location.origin);
    alert(error.message || "학급 생성에 실패했습니다.");
  } finally {
    creatingClass = false;
  }
});

// 새로고침 후에도 임시 학급 표시
async function initializeSavedClasses() {
  let legacy = [];
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      joinedStatus = '로그인 후 내 클래스를 확인해 주세요.';
      renderClasses([]);
      $('#membersStatus').textContent = '로그인 후 학급 멤버를 확인해 주세요.';
      return;
    }
    legacy = getSavedClasses(data.user.id);
    const classes = await classrooms.getOwnedClasses(legacy);
    ownedClassesLoaded = true;
    renderClasses(classes);
  } catch (error) {
    renderClasses(legacy);
    $('#membersStatus').textContent = error.message;
  }
}

if (!hasAuthCallbackError) {
  const date = document.querySelector('#overviewDate');
  if (date) date.textContent = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'full' }).format(new Date());
  initializeSavedClasses();
  loadJoinedClasses();
}


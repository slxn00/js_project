
import { supabase } from "./supabaseClient.js";

const $ = (id) => document.getElementById(id);

// 기존 admin.html 요소
const panel = document.querySelector(".calendar-panel");
const title = $("adminCalendarTitle");
const monthLabel = $("calendarMonth");
const days = $("calendarDays");
const dateLabel = $("calendarSelectedDate");
const dayEvents = $("calendarDayEvents");
const footer = $("calendarStatus");
const previous = $("calendarPrev");
const next = $("calendarNext");
const addButton = $("openCustomEventModal");

// 날짜 및 학급 상태
const today = new Date();

let year = today.getFullYear();
let month = today.getMonth() + 1;
let selectedDay = today.getDate();

let activeClassroom = null;
let currentUser = null;
let selectedSchool = null;
let entries = [];

let loadToken = 0;
let accountToken = 0;

// 날짜 유틸리티
const pad = (n) => String(n).padStart(2, "0");

const isoDate = (y, m, d) =>
  `${y}-${pad(m)}-${pad(d)}`;

function normalizedDate(date) {
  const raw = String(date ?? "")
    .replaceAll("-", "")
    .slice(0, 8);

  if (raw.length !== 8) return "";

  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function displayDate(day) {
  return isoDate(year, month, day);
}

function lastDay() {
  return new Date(year, month, 0).getDate();
}

// ========================================
// 1. 달력 및 모달 스타일
// ========================================

const styles = document.createElement("style");

styles.textContent = `
  .calendar-panel[hidden] {
    display: none !important;
  }

  .main-content {
    min-width: 0;
  }

  .admin-overview {
    width: 100%;
    max-width: none;
  }

  .calendar-panel {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-height: calc(100dvh - 76px);
  }

  .calendar-panel-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
  }

  .calendar-title-wrap {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }

  .calendar-title-wrap h2 {
    margin: 0;
  }

  .calendar-add-button {
    border: 1px solid #d9e6fb;
    border-radius: 9px;
    background: #edf4ff;
    color: #3182f6;
    padding: 9px 13px;
    font-weight: 700;
    cursor: pointer;
  }

  /* 달력 전체 */
  #calendarDays {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: repeat(6, minmax(110px, 1fr));
    gap: 0;
    flex: 1;
    min-height: 690px;
    margin-top: 12px;
  }

  /* 주 단위 영역 */
  .schedule-week {
    position: relative;
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    min-height: 110px;
    border-top: 1px solid #e9edf5;
  }

  .schedule-day,
  .schedule-empty {
    min-width: 0;
    height: 100%;
    border: 0;
    background: transparent;
    padding: 10px 7px 5px;
    text-align: center;
  }

  .schedule-day {
    color: #253349;
    cursor: pointer;
    position: relative;
    border-radius: 10px;
  }

  .schedule-day.selected {
    background: rgba(49, 130, 246, 0.09);
    color: #1766dd;
  }

  .schedule-day:focus-visible {
    outline: 2px solid #3182f6;
    outline-offset: -2px;
  }

  .schedule-day-number {
    font-size: 13px;
    font-weight: 650;
  }

  /* 기간 일정 막대 */
  .schedule-bars {
    pointer-events: none;
    position: absolute;
    inset: 35px 0 3px;
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    grid-auto-rows: 21px;
    gap: 3px 0;
    align-content: start;
  }

  .schedule-bar {
    min-width: 0;
    height: 21px;
    line-height: 21px;
    padding: 0 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    font-weight: 700;
    color: #1d64d8;
    background: #dceaff;
    margin: 0 1px;
  }

  .schedule-bar.custom {
    background: #cfe3ff;
    color: #174fa4;
  }

  .schedule-bar.single {
    border-radius: 5px;
    margin: 0 4px;
  }

  .schedule-bar.starts {
    border-radius: 5px 0 0 5px;
    margin-left: 4px;
    margin-right: 0;
  }

  .schedule-bar.middle {
    border-radius: 0;
    margin: 0;
  }

  .schedule-bar.ends {
    border-radius: 0 5px 5px 0;
    margin-left: 0;
    margin-right: 4px;
  }

  /* 날짜별 상세 일정 */
  .schedule-details-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 7px 0;
  }

  .schedule-details-row span {
    flex: 1;
  }

  .schedule-details-row button {
    border: 1px solid #f5cdcd;
    background: #fff2f2;
    color: #c54545;
    border-radius: 7px;
    padding: 4px 9px;
    cursor: pointer;
  }

  /* 하단에는 학교명만 */
  #calendarStatus {
    color: #8b95a1;
  }

  /* 일정 추가 모달 */
  .calendar-editor {
    position: fixed;
    inset: 0;
    width: min(460px, calc(100% - 28px));
    max-height: 88dvh;
    margin: auto;
    padding: 0;
    border: 0;
    border-radius: 22px;
    background: white;
    color: #191f28;
    box-shadow: 0 24px 80px #14243b33;
    overflow: auto;
  }

  .calendar-editor::backdrop {
    background: #1c2b4666;
    backdrop-filter: blur(9px);
    -webkit-backdrop-filter: blur(9px);
  }

  .calendar-editor form {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 28px;
  }

  .calendar-editor-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 10px;
    margin-bottom: 12px;
  }

  .calendar-editor-head h2 {
    font-size: 23px;
    margin: 0 0 7px;
  }

  .calendar-editor-head p {
    margin: 0;
    color: #8b95a1;
    font-size: 13px;
  }

  .calendar-editor-close {
    background: #f2f4f7;
    border: none;
    border-radius: 9px;
    font-size: 24px;
    width: 34px;
    height: 34px;
    cursor: pointer;
  }

  .calendar-editor label {
    font-size: 13px;
    font-weight: 700;
    margin-top: 5px;
  }

  .calendar-editor input,
  .calendar-editor textarea {
    width: 100%;
    min-width: 0;
    border: 1px solid #d9e2ec;
    border-radius: 10px;
    padding: 12px;
    font: inherit;
  }

  .calendar-editor input:focus,
  .calendar-editor textarea:focus {
    outline: 2px solid #99bfff;
  }

  .calendar-editor-dates {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .calendar-editor-dates > div {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .calendar-editor-submit {
    background: #3182f6;
    color: #fff;
    border: none;
    border-radius: 11px;
    padding: 13px;
    margin-top: 8px;
    font-weight: 700;
    cursor: pointer;
  }

  .calendar-editor-submit:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .calendar-editor-error {
    min-height: 18px;
    margin: 0;
    font-size: 12px;
    color: #c44141;
  }

  /* 우클릭 메뉴 */
  .calendar-context-menu {
    position: fixed;
    z-index: 9999;
    min-width: 165px;
    padding: 6px;
    background: #fff;
    border: 1px solid #e1e7ef;
    border-radius: 12px;
    box-shadow: 0 14px 40px #18253c30;
  }

  .calendar-context-menu button {
    display: block;
    width: 100%;
    padding: 11px 12px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }

  .calendar-context-menu button:hover {
    background: #edf4ff;
  }
`;

document.head.appendChild(styles);

// ========================================
// 2. 일정 추가 버튼
// ========================================

// 버튼이 HTML에 이미 있으면 재사용
let openButton = addButton;

// 버튼이 없으면 자동 생성
if (!openButton) {
  openButton = document.createElement("button");
  openButton.id = "openCustomEventModal";
  openButton.type = "button";
  openButton.textContent = "+ 일정 추가";
  openButton.className = "calendar-add-button";
}

const heading = title.parentElement;

// 제목과 추가 버튼을 함께 배치
if (!heading.classList.contains("calendar-title-wrap")) {
  const wrap = document.createElement("div");
  wrap.className = "calendar-title-wrap";

  heading.insertBefore(wrap, title);
  wrap.appendChild(title);
  wrap.appendChild(openButton);
} else if (!openButton.isConnected) {
  heading.appendChild(openButton);
}

// ========================================
// 3. 학사일정 등록 모달
// ========================================

// 기존 HTML 모달과 ID가 겹치지 않도록
// 독립적인 모달 생성
const editor = document.createElement("dialog");
editor.className = "calendar-editor";

editor.innerHTML = `
  <form id="calendarPeriodForm">

    <div class="calendar-editor-head">
      <div>
        <h2>학사일정 추가</h2>
        <p>우리 학급의 일정을 직접 등록해 주세요.</p>
      </div>

      <button
        type="button"
        class="calendar-editor-close"
        aria-label="닫기">
        ×
      </button>
    </div>

    <label for="periodEventName">일정명</label>
    <input
      id="periodEventName"
      type="text"
      maxlength="100"
      placeholder="예: 중간고사"
      required
    >

    <div class="calendar-editor-dates">
      <div>
        <label for="periodEventStart">시작일</label>
        <input
          id="periodEventStart"
          type="date"
          required
        >
      </div>

      <div>
        <label for="periodEventEnd">종료일</label>
        <input
          id="periodEventEnd"
          type="date"
          required
        >
      </div>
    </div>

    <label for="periodEventDescription">
      설명 (선택)
    </label>

    <textarea
      id="periodEventDescription"
      rows="3"
      maxlength="500"
      placeholder="일정에 대한 설명"
    ></textarea>

    <p
      class="calendar-editor-error"
      id="periodEventError"
      role="status">
    </p>

    <button
      class="calendar-editor-submit"
      type="submit">
      일정 등록하기
    </button>

  </form>
`;

document.body.appendChild(editor);

// 모달 요소 연결
const form = editor.querySelector("#calendarPeriodForm");
const inputName = editor.querySelector("#periodEventName");
const inputStart = editor.querySelector("#periodEventStart");
const inputEnd = editor.querySelector("#periodEventEnd");

const inputDescription = editor.querySelector(
  "#periodEventDescription"
);

const formError = editor.querySelector("#periodEventError");
const submit = editor.querySelector(".calendar-editor-submit");

// 닫기 버튼
editor
  .querySelector(".calendar-editor-close")
  .addEventListener("click", () => editor.close());

// 모달 바깥 클릭 시 닫기
editor.addEventListener("click", (event) => {
  if (event.target === editor) {
    editor.close();
  }
});

// ========================================
// 4. 날짜 우클릭 메뉴
// ========================================

const contextMenu = document.createElement("div");

contextMenu.className = "calendar-context-menu";
contextMenu.hidden = true;

contextMenu.innerHTML = `
  <button type="button">
    일정 추가하기
  </button>
`;

document.body.appendChild(contextMenu);

let contextDate = null;

function closeMenu() {
  contextMenu.hidden = true;
}

document.addEventListener("click", closeMenu);
window.addEventListener("scroll", closeMenu, true);
window.addEventListener("resize", closeMenu);

// 우클릭 메뉴의 일정 추가하기
contextMenu
  .querySelector("button")
  .addEventListener("click", () => {
    const date = contextDate;
    closeMenu();
    openEditor(date);
  });

// ========================================
// 5. 모달 열기
// ========================================

function openEditor(date = displayDate(selectedDay)) {
  if (!currentUser || !activeClassroom) return;

  form.reset();
  formError.textContent = "";

  // 선택한 날짜를 시작일과 종료일에 입력
  inputStart.value = date;
  inputEnd.value = date;

  editor.showModal();
  inputName.focus();
}

// 상단 일정 추가 버튼
openButton.addEventListener("click", () => {
  openEditor();
});

// ========================================
// 6. 선택한 날짜의 일정 표시
// ========================================

function renderSelectedDate() {
  dateLabel.textContent =
    `${year}년 ${month}월 ${selectedDay}일`;

  dayEvents.replaceChildren();

  const date = displayDate(selectedDay);

  const chosen = entries.filter(
    (event) => event.start <= date && date <= event.end
  );

  if (chosen.length === 0) {
    dayEvents.textContent = "등록된 학사일정이 없어요.";
    return;
  }

  for (const item of chosen) {
    const line = document.createElement("div");
    line.className = "schedule-details-row";

    const description = document.createElement("span");

    let text = item.name;

    // 여러 날에 걸친 일정은 기간 표시
    if (item.start !== item.end) {
      text += ` (${item.start} ~ ${item.end})`;
    }

    if (item.description) {
      text += ` · ${item.description}`;
    }

    description.textContent = text;
    line.appendChild(description);

    // 직접 등록한 일정만 삭제 가능
    if (item.source === "custom") {
      const remove = document.createElement("button");

      remove.type = "button";
      remove.textContent = "삭제";

      remove.addEventListener("click", () => {
        deleteEvent(item);
      });

      line.appendChild(remove);
    }

    dayEvents.appendChild(line);
  }
}

// ========================================
// 7. 달력 생성
// ========================================

function renderCalendar() {
  monthLabel.textContent = `${year}년 ${month}월`;
  days.replaceChildren();

  const firstWeekday = new Date(
    year,
    month - 1,
    1
  ).getDay();

  const daysInMonth = lastDay();

  const monthStart = isoDate(year, month, 1);
  const monthEnd = isoDate(year, month, daysInMonth);

  // 6주 고정
  for (let weekIndex = 0; weekIndex < 6; weekIndex++) {
    const week = document.createElement("div");
    week.className = "schedule-week";

    const weekStart = weekIndex * 7 - firstWeekday + 1;
    const weekEnd = weekStart + 6;

    // 일요일 ~ 토요일
    for (let col = 0; col < 7; col++) {
      const day = weekStart + col;

      // 이번 달이 아닌 날짜는 빈 칸
      if (day < 1 || day > daysInMonth) {
        const blank = document.createElement("span");
        blank.className = "schedule-empty";

        week.appendChild(blank);
        continue;
      }

      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "schedule-day";

      if (day === selectedDay) {
        cell.classList.add("selected");
      }

      const number = document.createElement("span");
      number.className = "schedule-day-number";
      number.textContent = String(day);

      cell.appendChild(number);

      // 일반 클릭: 날짜 선택
      cell.addEventListener("click", () => {
        selectedDay = day;

        renderSelectedDate();
        renderCalendar();
      });

      // 우클릭: 일정 추가 메뉴
      cell.addEventListener("contextmenu", (event) => {
        if (!activeClassroom || !currentUser) return;

        event.preventDefault();

        contextDate = displayDate(day);

        contextMenu.hidden = false;

        const menuWidth = contextMenu.offsetWidth || 170;
        const menuHeight = contextMenu.offsetHeight || 45;

        const x = Math.max(
          8,
          Math.min(
            event.clientX,
            window.innerWidth - menuWidth - 8
          )
        );

        const y = Math.max(
          8,
          Math.min(
            event.clientY,
            window.innerHeight - menuHeight - 8
          )
        );

        contextMenu.style.left = `${x}px`;
        contextMenu.style.top = `${y}px`;
      });

      week.appendChild(cell);
    }

    // 이번 주에 표시할 일정
    const segments = entries
      .filter(
        (event) =>
          event.start <= monthEnd &&
          event.end >= monthStart
      )
      .map((event) => {
        const eventStartInThisMonth =
          Number(event.start.slice(0, 4)) === year &&
          Number(event.start.slice(5, 7)) === month;

        const eventEndInThisMonth =
          Number(event.end.slice(0, 4)) === year &&
          Number(event.end.slice(5, 7)) === month;

        const start = Math.max(
          1,
          weekStart,
          eventStartInThisMonth
            ? Number(event.start.slice(8, 10))
            : 1
        );

        const end = Math.min(
          daysInMonth,
          weekEnd,
          eventEndInThisMonth
            ? Number(event.end.slice(8, 10))
            : daysInMonth
        );

        return { event, start, end };
      })
      .filter((segment) => segment.start <= segment.end)
      .sort(
        (a, b) =>
          a.start - b.start ||
          (b.end - b.start) - (a.end - a.start)
      );

    // 기간 일정 막대
    const bars = document.createElement("div");
    bars.className = "schedule-bars";

    const occupied = [];

    for (const segment of segments) {
      const colStart = segment.start - weekStart + 1;
      const colEnd = segment.end - weekStart + 1;

      // 일정이 겹치면 다음 줄에 표시
      let lane = 0;

      while (
        occupied[lane]?.some(
          ([a, b]) => colStart <= b && colEnd >= a
        )
      ) {
        lane++;
      }

      // 한 주에 표시하는 막대는 최대 4개 줄
      // 나머지 일정은 날짜를 클릭하면 상세 영역에 표시
      if (lane > 3) continue;

      occupied[lane] ||= [];
      occupied[lane].push([colStart, colEnd]);

      const bar = document.createElement("div");

      const startsHere =
        segment.event.start === displayDate(segment.start);

      const endsHere =
        segment.event.end === displayDate(segment.end);

      let shape = "middle";

      if (startsHere && endsHere) {
        shape = "single";
      } else if (startsHere) {
        shape = "starts";
      } else if (endsHere) {
        shape = "ends";
      }

      bar.className = `schedule-bar ${shape}`;

      if (segment.event.source === "custom") {
        bar.classList.add("custom");
      }

      bar.style.gridColumn =
        `${colStart} / ${colEnd + 1}`;

      bar.style.gridRow = `${lane + 1}`;

      bar.textContent = segment.event.name;

      bar.title =
        `${segment.event.name} (${segment.event.start} ~ ${segment.event.end})`;

      bars.appendChild(bar);
    }

    week.appendChild(bars);
    days.appendChild(week);
  }
}

// ========================================
// 8. 중복 학교 선택
// ========================================

function showSchoolChoices(schools) {
  let choices = $("neisSchoolChoices");

  if (!choices) {
    choices = document.createElement("div");
    choices.id = "neisSchoolChoices";

    days.before(choices);
  }

  choices.replaceChildren();
  choices.hidden = false;

  for (const school of schools) {
    const button = document.createElement("button");

    button.type = "button";

    button.textContent =
      `${school.name} (${school.address || "주소 없음"})`;

    button.addEventListener("click", () => {
      selectedSchool = school;
      choices.hidden = true;
      loadSchedule();
    });

    choices.appendChild(button);
  }
}

// ========================================
// 9. Supabase 직접 등록 일정 조회
// ========================================

async function loadCustomEvents(classId, y, m) {
  const start = isoDate(y, m, 1);

  const end = isoDate(
    y,
    m,
    new Date(y, m, 0).getDate()
  );

  const { data, error } = await supabase
    .from("custom_calendar_events")
    .select("id, event_date, end_date, name, description")
    .eq("classroom_id", classId)

    // 현재 달에 하루라도 겹치는 일정 조회
    .lte("event_date", end)
    .gte("end_date", start)

    .order("event_date", { ascending: true });

  if (error) throw error;

  return (data || []).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description || "",
    start: normalizedDate(row.event_date),
    end: normalizedDate(row.end_date || row.event_date),
    source: "custom"
  }));
}

// ========================================
// 10. 나이스 + 직접 등록 일정 조회
// ========================================

async function loadSchedule() {
  if (!activeClassroom) return;

  const token = ++loadToken;

  const classId = activeClassroom.id;
  const y = year;
  const m = month;

  entries = [];

  renderCalendar();
  renderSelectedDate();

  const schoolName = activeClassroom.school_name || "학교";

  // 학교명만 표시
  title.textContent = `${schoolName} 학사일정`;
  footer.textContent = schoolName;

  // 나이스와 직접 등록 일정을 각각 조회
  const [neisResult, customResult] =
    await Promise.allSettled([
      supabase.functions.invoke("neis-calendar", {
        body: {
          classroomId: classId,
          year: y,
          month: m,

          ...(selectedSchool
            ? {
                officeCode: selectedSchool.officeCode,
                schoolCode: selectedSchool.schoolCode
              }
            : {})
        }
      }),

      loadCustomEvents(classId, y, m)
    ]);

  // 이전 요청이 뒤늦게 완료된 경우 무시
  if (
    token !== loadToken ||
    activeClassroom?.id !== classId
  ) {
    return;
  }

  let schoolEvents = [];
  let customEvents = [];

  // 나이스 학사일정
  if (neisResult.status === "fulfilled") {
    const { data, error } = neisResult.value;

    if (error) {
      console.warn("나이스 조회 오류:", error);
    } else if (data?.status === "choose-school") {
      showSchoolChoices(data.schools || []);
    } else if (data?.status === "ok") {
      schoolEvents = (data.events || []).map((event) => ({
        name: event.name,
        description: event.description || "",
        start: normalizedDate(event.date),
        end: normalizedDate(event.date),
        source: "neis"
      }));
    } else {
      console.warn("나이스 조회 응답:", data);
    }
  } else {
    console.warn("나이스 호출 실패:", neisResult.reason);
  }

  // 관리자가 직접 등록한 일정
  if (customResult.status === "fulfilled") {
    customEvents = customResult.value;
  } else {
    console.error(
      "직접 등록 일정 조회 실패:",
      customResult.reason
    );
  }

  // 모든 일정 합치기
  entries = [
    ...schoolEvents,
    ...customEvents
  ].filter((event) => event.start && event.end);

  renderCalendar();
  renderSelectedDate();
}

// ========================================
// 11. 일정 저장
// ========================================

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!activeClassroom || !currentUser) return;

  const name = inputName.value.trim();
  const start = inputStart.value;
  const end = inputEnd.value;
  const description = inputDescription.value.trim();

  if (!name || !start || !end) {
    formError.textContent =
      "일정명과 시작일, 종료일을 입력해 주세요.";

    return;
  }

  if (start > end) {
    formError.textContent =
      "종료일은 시작일보다 빠를 수 없어요.";

    return;
  }

  submit.disabled = true;
  formError.textContent = "저장하고 있어요...";

  try {
    const { error } = await supabase
      .from("custom_calendar_events")
      .insert({
        classroom_id: activeClassroom.id,

        // 기존 테이블의 컬럼 유지
        event_date: start,
        end_date: end,
        name,
        description,
        created_by: currentUser.id
      });

    if (error) throw error;

    editor.close();

    // 등록한 일정의 시작 월로 이동
    const saved = new Date(`${start}T12:00:00`);

    year = saved.getFullYear();
    month = saved.getMonth() + 1;
    selectedDay = saved.getDate();

    await loadSchedule();

  } catch (error) {
    console.error("일정 등록 오류:", error);

    formError.textContent =
      `등록에 실패했어요: ${error.message}`;

  } finally {
    submit.disabled = false;
  }
});

// ========================================
// 12. 일정 삭제
// ========================================

async function deleteEvent(item) {
  if (
    !activeClassroom ||
    item.source !== "custom"
  ) {
    return;
  }

  const confirmed = window.confirm(
    `'${item.name}' 일정을 삭제할까요?`
  );

  if (!confirmed) return;

  const { error } = await supabase
    .from("custom_calendar_events")
    .delete()
    .eq("id", item.id)
    .eq("classroom_id", activeClassroom.id);

  if (error) {
    console.error("일정 삭제 오류:", error);

    window.alert("일정을 삭제하지 못했어요.");
    return;
  }

  await loadSchedule();
}

// ========================================
// 13. 현재 관리자 학급 조회
// ========================================

async function loadClassrooms() {
  const token = ++accountToken;

  ++loadToken;

  activeClassroom = null;
  currentUser = null;
  selectedSchool = null;
  entries = [];

  // 학급 확인 전에는 달력 숨김
  panel.hidden = true;

  try {
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser();

    if (token !== accountToken) return;

    if (authError || !user) return;

    // 현재 선생님이 생성한 학급 조회
    const { data, error } = await supabase
      .from("checkin_classrooms")
      .select("id, school_name, created_at")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false });

    if (token !== accountToken) return;

    if (error) throw error;

    // 학급이 없으면 달력 표시 안 함
    if (!data?.length) return;

    currentUser = user;
    activeClassroom = data[0];

    // 학급이 확인되면 달력 표시
    panel.hidden = false;

    // 해당 학교 일정 자동 불러오기
    await loadSchedule();

  } catch (error) {
    console.error("학급 조회 오류:", error);
    panel.hidden = true;
  }
}

// ========================================
// 14. 이전 달 / 다음 달
// ========================================

previous.addEventListener("click", () => {
  month--;

  if (month < 1) {
    month = 12;
    year--;
  }

  selectedDay = Math.min(selectedDay, lastDay());

  closeMenu();
  loadSchedule();
});

next.addEventListener("click", () => {
  month++;

  if (month > 12) {
    month = 1;
    year++;
  }

  selectedDay = Math.min(selectedDay, lastDay());

  closeMenu();
  loadSchedule();
});

// ========================================
// 15. 로그인 상태 변경
// ========================================

supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    ++accountToken;
    ++loadToken;

    activeClassroom = null;
    currentUser = null;
    entries = [];

    panel.hidden = true

    if (editor.open) {
      editor.close();
    }

  } else if (event === "SIGNED_IN") {
    setTimeout(loadClassrooms, 0);
  }
});

// ========================================
// 16. 최초 실행
// ========================================

panel.hidden = true;

loadClassrooms();

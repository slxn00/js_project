import { supabase } from "./supabaseClient.js";

const $ = (id) => document.getElementById(id);

// 기존 admin.html 요소
const prevButton = $("calendarPrev");
const nextButton = $("calendarNext");
const monthTitle = $("calendarMonth");
const daysContainer = $("calendarDays");
const selectedDateTitle = $("calendarSelectedDate");
const dayEvents = $("calendarDayEvents");
const statusText = $("calendarStatus");
const calendarPanel = document.querySelector(".calendar-panel");

// 현재 날짜
const now = new Date();

let year = now.getFullYear();
let month = now.getMonth() + 1;
let selectedDay = now.getDate();

let events = [];
let classrooms = [];
let classroomId = null;
let selectedSchool = null;
let requestNumber = 0;
let currentUser = null;

// 직접 추가한 일정 ID 목록
let customEventIds = new Set();

const pad = (value) => String(value).padStart(2, "0");

function dateKey(day) {
  return `${year}${pad(month)}${pad(day)}`;
}

// 날짜 문자열을 YYYYMMDD 형식으로 변환
function normalizeDate(date) {
  return String(date).replaceAll("-", "").slice(0, 8);
}

function setStatus(message) {
  if (statusText) {
    statusText.textContent = message;
  }
}

// 직접 일정 추가 UI 생성
const customEventForm = document.createElement("form");

customEventForm.id = "customCalendarEventForm";
customEventForm.innerHTML = `
  <h3>직접 일정 등록</h3>

  <label for="customEventDate">날짜</label>
  <input
    type="date"
    id="customEventDate"
    required
  >

  <label for="customEventName">일정명</label>
  <input
    type="text"
    id="customEventName"
    maxlength="100"
    placeholder="예: 수학 시험"
    required
  >

  <label for="customEventDescription">설명</label>
  <textarea
    id="customEventDescription"
    maxlength="500"
    placeholder="일정에 대한 설명을 입력하세요."
  ></textarea>

  <button type="submit" id="customEventSubmit">
    일정 추가
  </button>

  <p id="customEventMessage" role="status"></p>
`;

const customEventDate = customEventForm.querySelector("#customEventDate");
const customEventName = customEventForm.querySelector("#customEventName");
const customEventDescription =
  customEventForm.querySelector("#customEventDescription");
const customEventSubmit =
  customEventForm.querySelector("#customEventSubmit");
const customEventMessage =
  customEventForm.querySelector("#customEventMessage");

// 기존 달력의 일정 표시 영역 아래에 폼 배치
if (dayEvents) {
  dayEvents.insertAdjacentElement("afterend", customEventForm);
}

// 간단한 기본 스타일
const customEventStyle = document.createElement("style");

customEventStyle.textContent = `
  #customCalendarEventForm {
    display: grid;
    gap: 10px;
    margin-top: 20px;
    padding: 18px;
    border: 1px solid #dddddd;
    border-radius: 12px;
  }

  #customCalendarEventForm h3 {
    margin: 0 0 4px;
  }

  #customCalendarEventForm label {
    font-size: 14px;
    font-weight: 600;
  }

  #customCalendarEventForm input,
  #customCalendarEventForm textarea {
    box-sizing: border-box;
    width: 100%;
    padding: 10px;
    border: 1px solid #cccccc;
    border-radius: 8px;
    font: inherit;
  }

  #customCalendarEventForm textarea {
    min-height: 80px;
    resize: vertical;
  }

  #customCalendarEventForm button {
    padding: 10px 14px;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font: inherit;
  }

  #customEventMessage {
    margin: 0;
    font-size: 14px;
    white-space: pre-line;
  }

  .custom-event-delete {
    margin-left: 8px;
    padding: 3px 8px;
    border: 1px solid #cccccc;
    border-radius: 6px;
    cursor: pointer;
  }
`;

document.head.appendChild(customEventStyle);

// 선택한 날짜의 학사일정 표시
function showDayEvents(day) {
  selectedDay = day;

  selectedDateTitle.textContent =
    `${year}년 ${month}월 ${day}일`;

  const selectedDate = dateKey(day);

  const selectedEvents = events.filter(
    (event) => normalizeDate(event.date) === selectedDate
  );

  dayEvents.replaceChildren();

  if (selectedEvents.length === 0) {
    dayEvents.textContent = "등록된 학사일정이 없어요.";
  } else {
    selectedEvents.forEach((event) => {
      const eventRow = document.createElement("div");
      eventRow.className = "calendar-event-row";

      const eventName = document.createElement("span");

      eventName.textContent =
        customEventIds.has(event.id)
          ? `📝 ${event.name}`
          : `• ${event.name}`;

      eventRow.appendChild(eventName);

      // 직접 등록한 일정만 삭제 버튼 표시
      if (customEventIds.has(event.id)) {
        const deleteButton = document.createElement("button");

        deleteButton.type = "button";
        deleteButton.className = "custom-event-delete";
        deleteButton.textContent = "삭제";

        deleteButton.addEventListener("click", () => {
          deleteCustomEvent(event.id);
        });

        eventRow.appendChild(deleteButton);
      }

      dayEvents.appendChild(eventRow);

      // 설명이 있는 일정은 설명도 표시
      if (event.description) {
        const description = document.createElement("p");

        description.textContent = event.description;
        description.style.margin = "4px 0 12px";

        dayEvents.appendChild(description);
      }
    });
  }

  customEventDate.value =
    `${year}-${pad(month)}-${pad(day)}`;

  renderCalendar();
}

// 달력 날짜 생성
function renderCalendar() {
  monthTitle.textContent = `${year}년 ${month}월`;

  daysContainer.replaceChildren();

  const firstWeekday = new Date(
    year,
    month - 1,
    1
  ).getDay();

  const lastDay = new Date(
    year,
    month,
    0
  ).getDate();

  // 첫째 날 이전의 빈 칸
  for (let i = 0; i < firstWeekday; i++) {
    const empty = document.createElement("span");

    empty.className = "calendar-empty";

    daysContainer.appendChild(empty);
  }

  // 날짜 버튼 생성
  for (let day = 1; day <= lastDay; day++) {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "calendar-day";

    const dayNumber = document.createElement("span");

    dayNumber.textContent = day;
    dayNumber.className = "calendar-day-number";

    button.appendChild(dayNumber);

    const currentDate = dateKey(day);

    const daySchedule = events.filter(
      (event) => normalizeDate(event.date) === currentDate
    );

    daySchedule.forEach((event) => {
      const eventLabel = document.createElement("span");

      eventLabel.className = "calendar-event-label";

      eventLabel.textContent = event.name;
      eventLabel.title = event.name;

      button.appendChild(eventLabel);
    });

    if (daySchedule.length > 0) {
      button.classList.add("has-event");
    }

    if (day === selectedDay) {
      button.classList.add("selected");
    }

    button.addEventListener("click", () => {
      showDayEvents(day);
    });

    daysContainer.appendChild(button);
  }
}

// 학교명이 중복될 경우 표시할 영역
const schoolChoices = document.createElement("div");

schoolChoices.id = "neisSchoolChoices";
schoolChoices.hidden = true;

daysContainer.before(schoolChoices);

function showSchoolChoices(schools) {
  schoolChoices.replaceChildren();

  schoolChoices.hidden = false;

  setStatus("동일한 이름의 학교가 있어요. 학교를 선택해 주세요.");

  for (const school of schools) {
    const button = document.createElement("button");

    button.type = "button";

    button.textContent =
      `${school.name} (${school.address || "주소 없음"})`;

    button.addEventListener("click", () => {
      selectedSchool = school;

      schoolChoices.hidden = true;

      loadSchedule();
    });

    schoolChoices.appendChild(button);
  }
}

// 직접 등록한 일정 조회
async function loadCustomEvents() {
  if (!classroomId) {
    return [];
  }

  const startDate =
    `${year}-${pad(month)}-01`;

  const nextMonthDate = new Date(
    year,
    month,
    1
  );

  const endDate =
    `${nextMonthDate.getFullYear()}-${pad(
      nextMonthDate.getMonth() + 1
    )}-01`;

  const { data, error } = await supabase
    .from("custom_calendar_events")
    .select("id, classroom_id, event_date, name, description")
    .eq("classroom_id", classroomId)
    .gte("event_date", startDate)
    .lt("event_date", endDate)
    .order("event_date", { ascending: true });

  if (error) {
    throw error;
  }

  const customEvents = data || [];

  customEventIds = new Set(
    customEvents.map((event) => event.id)
  );

  return customEvents.map((event) => ({
    id: event.id,
    date: normalizeDate(event.event_date),
    name: event.name,
    description: event.description || "",
    source: "custom",
  }));
}

// 나이스 일정 + 직접 등록한 일정 조회
async function loadSchedule() {
  const currentRequest = ++requestNumber;

  events = [];

  customEventIds = new Set();

  schoolChoices.hidden = true;

  showDayEvents(selectedDay);

  if (!classroomId) {
    setStatus("먼저 학급을 생성해 주세요.");
    return;
  }

  setStatus("학사일정을 불러오고 있어요...");

  try {
    // 기존 나이스 학사일정 조회
    const { data, error } = await supabase.functions.invoke(
      "neis-calendar",
      {
        body: {
          classroomId,
          year,
          month,
          ...(selectedSchool
            ? {
                officeCode: selectedSchool.officeCode,
                schoolCode: selectedSchool.schoolCode,
              }
            : {}),
        },
      }
    );

    if (currentRequest !== requestNumber) {
      return;
    }

    if (error) {
      let message = error.message;

      try {
        const result = await error.context?.json();

        message = result?.message || message;
      } catch {
        // 응답 본문을 읽을 수 없는 경우
      }

      throw new Error(message);
    }

    if (data?.status === "choose-school") {
      showSchoolChoices(data.schools || []);
      return;
    }

    if (data?.status !== "ok") {
      throw new Error("학사일정을 가져오지 못했습니다.");
    }

    const schoolName = data.school?.name || "학교";

    const calendarTitle =
      document.getElementById("adminCalendarTitle");

    if (calendarTitle) {
      calendarTitle.textContent = `${schoolName} 학사일정`;
    }

    // 나이스 일정은 기존처럼 유지
    const schoolEvents = data.events || [];

    // 직접 등록한 일정 조회
    let customEvents = [];

    try {
      customEvents = await loadCustomEvents();
    } catch (customError) {
      console.error("직접 등록한 일정 조회 실패:", customError);

      customEventMessage.textContent =
        "직접 등록한 일정을 불러오지 못했어요. 데이터베이스 설정을 확인해 주세요.";
    }

    if (currentRequest !== requestNumber) {
      return;
    }

    // 나이스 일정과 직접 등록한 일정을 합침
    events = [
      ...schoolEvents,
      ...customEvents,
    ];

    console.log("나이스 학사일정:", schoolEvents);
    console.log("직접 등록한 일정:", customEvents);

    showDayEvents(selectedDay);

    setStatus(
      `${schoolName} · 학교 일정 ${schoolEvents.length}건, 직접 등록 ${customEvents.length}건`
    );
  } catch (error) {
    if (currentRequest !== requestNumber) {
      return;
    }

    console.error("학사일정 조회 오류:", error);

    setStatus(`학사일정 조회 실패: ${error.message}`);

    dayEvents.textContent =
      "학사일정을 불러오지 못했어요.";
  }
}

// 직접 일정 추가
customEventForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser || !classroomId) {
    customEventMessage.textContent =
      "로그인 후 학급을 선택해 주세요.";

    return;
  }

  const eventDate = customEventDate.value;
  const eventName = customEventName.value.trim();
  const description = customEventDescription.value.trim();

  if (!eventDate || !eventName) {
    customEventMessage.textContent =
      "날짜와 일정명을 입력해 주세요.";

    return;
  }

  // 날짜 형식 확인
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    customEventMessage.textContent =
      "올바른 날짜를 선택해 주세요.";

    return;
  }

  customEventSubmit.disabled = true;

  customEventMessage.textContent =
    "일정을 저장하고 있어요...";

  try {
    const { error } = await supabase
      .from("custom_calendar_events")
      .insert({
        classroom_id: classroomId,
        event_date: eventDate,
        name: eventName,
        description,
        created_by: currentUser.id,
      });

    if (error) {
      throw error;
    }

    // 등록한 달로 이동
    const selectedDate = new Date(
      `${eventDate}T12:00:00`
    );

    year = selectedDate.getFullYear();
    month = selectedDate.getMonth() + 1;
    selectedDay = selectedDate.getDate();

    customEventName.value = "";
    customEventDescription.value = "";

    customEventMessage.textContent =
      "일정이 등록되었어요.";

    await loadSchedule();
  } catch (error) {
    console.error("일정 등록 실패:", error);

    customEventMessage.textContent =
      `일정 등록 실패: ${error.message}`;
  } finally {
    customEventSubmit.disabled = false;
  }
});

// 직접 등록한 일정 삭제
async function deleteCustomEvent(eventId) {
  if (!customEventIds.has(eventId)) {
    return;
  }

  const confirmed = window.confirm(
    "이 일정을 삭제할까요?"
  );

  if (!confirmed) {
    return;
  }

  try {
    const { error } = await supabase
      .from("custom_calendar_events")
      .delete()
      .eq("id", eventId)
      .eq("classroom_id", classroomId);

    if (error) {
      throw error;
    }

    customEventMessage.textContent =
      "일정이 삭제되었어요.";

    await loadSchedule();
  } catch (error) {
    console.error("일정 삭제 실패:", error);

    customEventMessage.textContent =
      `일정 삭제 실패: ${error.message}`;
  }
}

// 관리자 학급 정보 조회
async function loadClassrooms() {
  const currentRequest = ++requestNumber;

  calendarPanel.hidden = true;

  classroomId = null;
  selectedSchool = null;
  classrooms = [];
  events = [];
  customEventIds = new Set();

  const schoolTitle =
    document.getElementById("adminCalendarTitle");

  if (schoolTitle) {
    schoolTitle.textContent = "학교 학사일정";
  }

  setStatus("학급 정보를 확인하고 있어요...");

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (currentRequest !== requestNumber) {
    return;
  }

  if (authError || !user) {
    currentUser = null;

    setStatus("로그인 후 학사일정을 확인할 수 있어요.");

    return;
  }

  currentUser = user;

  const { data, error } = await supabase
    .from("checkin_classrooms")
    .select("id, school_name, created_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  if (currentRequest !== requestNumber) {
    return;
  }

  if (error) {
    console.error("학급 조회 오류:", error);

    setStatus("학급 정보를 가져오지 못했습니다.");

    return;
  }

  classrooms = data || [];

  console.log("현재 로그인 계정:", user.id);
  console.log("달력 학급 목록:", classrooms);

  if (classrooms.length === 0) {
    setStatus("생성한 학급이 없습니다.");

    return;
  }

  // 가장 최근에 생성한 학급을 사용
  classroomId = classrooms[0].id;

  calendarPanel.hidden = false;

  console.log(
    "자동 연결된 학교:",
    classrooms[0].school_name
  );

  await loadSchedule();
}

// 이전 달
prevButton.addEventListener("click", () => {
  month--;

  if (month < 1) {
    month = 12;
    year--;
  }

  selectedDay = Math.min(
    selectedDay,
    new Date(year, month, 0).getDate()
  );

  loadSchedule();
});

// 다음 달
nextButton.addEventListener("click", () => {
  month++;

  if (month > 12) {
    month = 1;
    year++;
  }

  selectedDay = Math.min(
    selectedDay,
    new Date(year, month, 0).getDate()
  );

  loadSchedule();
});

// 로그인 상태 변경 처리
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT" || event === "SIGNED_IN") {
    currentUser = null;
    classroomId = null;
    events = [];
    customEventIds = new Set();

    calendarPanel.hidden = true;

    setTimeout(() => {
      loadClassrooms();
    }, 0);
  }
});

// 처음 실행
showDayEvents(selectedDay);
loadClassrooms();

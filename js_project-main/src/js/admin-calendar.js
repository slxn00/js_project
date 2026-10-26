
import { supabase } from "./supabaseClient.js";

const $ = (id) => document.getElementById(id);

// 기존 admin.html에 있는 요소들
const prevButton = $("calendarPrev");
const nextButton = $("calendarNext");
const monthTitle = $("calendarMonth");
const daysContainer = $("calendarDays");
const selectedDateTitle = $("calendarSelectedDate");
const dayEvents = $("calendarDayEvents");
const statusText = $("calendarStatus");

const now = new Date();

let year = now.getFullYear();
let month = now.getMonth() + 1;
let selectedDay = now.getDate();

let events = [];
let classrooms = [];
let classroomId = null;
let selectedSchool = null;
let requestNumber = 0;

const pad = (value) => String(value).padStart(2, "0");

function dateKey(day) {
  return `${year}${pad(month)}${pad(day)}`;
}

function setStatus(message) {
  if (statusText) {
    statusText.textContent = message;
  }
}

// 선택한 날짜의 학사일정 표시
function showDayEvents(day) {
  selectedDay = day;

  selectedDateTitle.textContent =
    `${year}년 ${month}월 ${day}일`;

  const selectedEvents = events.filter(
    (event) => event.date === dateKey(day)
  );

  if (selectedEvents.length === 0) {
    dayEvents.textContent = "등록된 학사일정이 없어요.";
  } else {
    dayEvents.textContent = selectedEvents
      .map((event) => `• ${event.name}`)
      .join("\n");
  }

  dayEvents.style.whiteSpace = "pre-line";

  renderCalendar();
}

// 기존 디자인의 달력 날짜 생성
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

  // 1일부터 마지막 날까지 버튼 생성
  for (let day = 1; day <= lastDay; day++) {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "calendar-day";

    const dayNumber = document.createElement("span");
    dayNumber.textContent = day;
    dayNumber.className = "calendar-day-number";

    button.appendChild(dayNumber);

    const daySchedule = events.filter(
      event => event.date === dateKey(day)
    );

    daySchedule.forEach(event => {
      const eventLabel = document.createElement("span");

      eventLabel.className = "calendar-event-label";
      eventLabel.textContent = event.name;
      eventLabel.title = event.name;

      button.appendChild(eventLabel);
    });


    const hasEvent = events.some(
      (event) => event.date === dateKey(day)
    );

    if (hasEvent) {
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

// Supabase Edge Function을 통한 나이스 조회
async function loadSchedule() {
  const currentRequest = ++requestNumber;

  events = [];
  schoolChoices.hidden = true;

  showDayEvents(selectedDay);

  if (!classroomId) {
    setStatus("먼저 학급을 생성해 주세요.");
    return;
  }

  setStatus("나이스 학사일정을 불러오고 있어요...");

  try {
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

    if (currentRequest !== requestNumber) return;

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

    // 나이스가 반환한 모든 일정 사용
    events = data.events || [];

    console.log("나이스 학사일정 전체:", events);

    setStatus(
      `${data.school.name} · 학사일정 ${events.length}건`
    );

    showDayEvents(selectedDay);

    setStatus(
      `${data.school.name} 학사일정 · ${events.length}건 조회`
    );

    showDayEvents(selectedDay);

  } catch (error) {
    if (currentRequest !== requestNumber) return;

    console.error("나이스 API 오류:", error);

    setStatus(`학사일정 조회 실패: ${error.message}`);
    dayEvents.textContent = "학사일정을 불러오지 못했어요.";
  }
}



async function loadClassrooms() {
  setStatus("학교 학사일정을 불러오고 있어요...");

  // 현재 로그인한 관리자 확인
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();

  if (authError || !user) {
    setStatus("로그인 후 학사일정을 확인할 수 있어요.");
    return;
  }

  // 관리자가 생성한 학급 조회
  const { data, error } = await supabase
    .from("checkin_classrooms")
    .select("id, school_name, created_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("학급 조회 오류:", error);
    setStatus("학급 정보를 가져오지 못했습니다.");
    return;
  }

  classrooms = data || [];

  if (classrooms.length === 0) {
    setStatus("생성한 학급이 없습니다.");
    return;
  }

  // 가장 최근에 생성한 학급을 자동으로 사용
  const activeClassroom = classrooms[0];

  classroomId = activeClassroom.id;
  selectedSchool = null;

  console.log(
    "자동 연결된 학교:",
    activeClassroom.school_name
  );

  // 선택 과정 없이 학사일정 자동 조회
  await loadSchedule();
}


// 이전 달 버튼
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

// 다음 달 버튼
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

// 페이지 실행 시 달력 먼저 표시
showDayEvents(selectedDay);

// 그다음 나이스 학사일정 조회
loadClassrooms();

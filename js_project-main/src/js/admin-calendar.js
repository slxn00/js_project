
import { supabase } from "./supabaseClient.js";

const $ = (id) => document.getElementById(id);

// 기존 admin.html의 요소
const calendarPanel = document.querySelector(".calendar-panel");
const calendarTitle = $("adminCalendarTitle");

const prevButton = $("calendarPrev");
const nextButton = $("calendarNext");
const monthTitle = $("calendarMonth");
const daysContainer = $("calendarDays");

const selectedDateTitle = $("calendarSelectedDate");
const dayEvents = $("calendarDayEvents");
const statusText = $("calendarStatus");

// 날짜
const today = new Date();

let year = today.getFullYear();
let month = today.getMonth() + 1;
let selectedDay = today.getDate();

// 학급 및 학사일정
let classrooms = [];
let classroomId = null;
let selectedSchool = null;
let events = [];

// 비동기 요청 관리
let requestNumber = 0;
let classRequestNumber = 0;

const pad = (value) => String(value).padStart(2, "0");

function dateKey(day) {
  return `${year}${pad(month)}${pad(day)}`;
}

function setStatus(message) {
  if (statusText) {
    statusText.textContent = message;
  }
}

// 달력 숨기기
function hideCalendar() {
  calendarPanel.hidden = true;

  classroomId = null;
  selectedSchool = null;
  classrooms = [];
  events = [];

  // 이전 요청의 결과가 나중에 도착해도 반영하지 않음
  requestNumber++;

  calendarTitle.textContent = "학교 학사일정";
}

// 선택한 날짜의 일정 표시
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

// 달력 생성
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

  // 첫 주 빈 칸
  for (let i = 0; i < firstWeekday; i++) {
    const empty = document.createElement("span");
    empty.className = "calendar-empty";

    daysContainer.appendChild(empty);
  }

  // 날짜 생성
  for (let day = 1; day <= lastDay; day++) {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "calendar-day";

    // 날짜 숫자
    const dayNumber = document.createElement("span");

    dayNumber.className = "calendar-day-number";
    dayNumber.textContent = day;

    button.appendChild(dayNumber);

    // 해당 날짜에 등록된 모든 나이스 학사일정
    const daySchedule = events.filter(
      (event) => event.date === dateKey(day)
    );

    for (const event of daySchedule) {
      const eventLabel = document.createElement("span");

      eventLabel.className = "calendar-event-label";
      eventLabel.textContent = event.name;
      eventLabel.title = event.name;

      button.appendChild(eventLabel);
    }

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

// 동일한 이름의 학교가 여러 개일 때
const schoolChoices = document.createElement("div");

schoolChoices.id = "neisSchoolChoices";
schoolChoices.hidden = true;

daysContainer.before(schoolChoices);

function showSchoolChoices(schools) {
  schoolChoices.replaceChildren();
  schoolChoices.hidden = false;

  setStatus(
    "같은 이름의 학교가 있어요. 정확한 학교를 선택해 주세요."
  );

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

// 나이스 학사일정 조회
async function loadSchedule() {
  const currentRequest = ++requestNumber;

  events = [];
  schoolChoices.hidden = true;

  showDayEvents(selectedDay);

  if (!classroomId) {
    setStatus("등록된 학급이 없습니다.");
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
              schoolCode: selectedSchool.schoolCode
            }
            : {})
        }
      }
    );

    // 이미 다른 학급이나 달을 조회 중이면 이전 결과 무시
    if (currentRequest !== requestNumber) return;

    if (error) {
      let message = error.message;

      try {
        const response = await error.context?.json();
        message = response?.message || message;
      } catch {
        // 서버 응답을 읽을 수 없는 경우
      }

      throw new Error(message);
    }

    // 학교 이름이 중복되는 경우
    if (data?.status === "choose-school") {
      showSchoolChoices(data.schools || []);
      return;
    }

    if (data?.status !== "ok") {
      throw new Error("학사일정을 가져오지 못했습니다.");
    }

    // 학교 이름 자동 표시
    if (data.school?.name) {
      calendarTitle.textContent =
        `${data.school.name} 학사일정`;
    }

    // 나이스가 반환한 모든 일정 사용
    events = data.events || [];

    console.log("나이스 학사일정:", events);

    setStatus(
      `${data.school.name} 학사일정 · ${events.length}건 조회`
    );

    showDayEvents(selectedDay);

  } catch (error) {
    if (currentRequest !== requestNumber) return;

    console.error("나이스 학사일정 조회 오류:", error);

    setStatus(
      `학사일정 조회 실패: ${error.message}`
    );

    dayEvents.textContent =
      "학사일정을 불러오지 못했어요.";
  }
}

// 로그인한 관리자의 학급 조회
async function loadClassrooms() {
  const currentClassRequest = ++classRequestNumber;

  // 조회가 완료되기 전까지 숨김
  hideCalendar();

  setStatus("학급 정보를 확인하고 있어요...");

  try {
    // 현재 로그인한 사용자 확인
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser();

    if (currentClassRequest !== classRequestNumber) return;

    if (authError || !user) {
      setStatus("로그인이 필요합니다.");
      return;
    }

    // 현재 사용자가 생성한 학급 조회
    const { data, error } = await supabase
      .from("checkin_classrooms")
      .select("id, school_name, created_at")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false });

    if (currentClassRequest !== classRequestNumber) return;

    if (error) {
      console.error("학급 조회 오류:", error);

      setStatus(
        `학급 정보를 가져오지 못했습니다: ${error.message}`
      );

      return;
    }

    classrooms = data || [];

    console.log("현재 계정의 학급:", classrooms);

    // 학급이 없다면 달력을 계속 숨김
    if (classrooms.length === 0) {
      calendarPanel.hidden = true;

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

    // 학급이 확인되었을 때만 달력 표시
    calendarPanel.hidden = false;

    // 학교 이름을 먼저 표시
    calendarTitle.textContent =
      `${activeClassroom.school_name || "학교"} 학사일정`;

    // 나이스 학사일정 자동 조회
    await loadSchedule();

  } catch (error) {
    if (currentClassRequest !== classRequestNumber) return;

    console.error("학급 확인 오류:", error);

    hideCalendar();

    setStatus("학급 정보를 확인하지 못했습니다.");
  }
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

// 로그인 / 로그아웃 감지
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    classRequestNumber++;
    hideCalendar();
    return;
  }

  if (event === "SIGNED_IN") {
    // 로그인한 계정의 학급을 다시 확인
    setTimeout(() => {
      loadClassrooms();
    }, 0);
  }
});

// 최초 실행
renderCalendar();
loadClassrooms();

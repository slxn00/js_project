
import { supabase } from "./supabaseClient.js";

const $ = (id) => document.getElementById(id);

const classSelect = $("neisClassSelect");
const status = $("neisStatus");
const monthTitle = $("neisMonth");
const days = $("neisDays");
const eventsBox = $("neisEvents");
const selectedTitle = $("neisSelectedDate");
const schoolChoices = $("neisSchoolChoices");

const today = new Date();

let year = today.getFullYear();
let month = today.getMonth() + 1;
let selectedDay = today.getDate();

let events = [];
let selectedSchool = null;
let requestId = 0;

const pad = (number) => String(number).padStart(2, "0");

function formatDate(day) {
  return `${year}${pad(month)}${pad(day)}`;
}

// 날짜를 선택하면 해당 날짜의 일정 표시
function showEvents(day) {
  selectedDay = day;

  selectedTitle.textContent =
    `${year}년 ${month}월 ${day}일`;

  eventsBox.replaceChildren();

  const selected = events.filter(
    event => event.date === formatDate(day)
  );

  if (selected.length === 0) {
    eventsBox.textContent = "등록된 학사일정이 없어요.";
  }

  for (const event of selected) {
    const item = document.createElement("p");
    item.className = "neis-event-item";
    item.textContent = event.name;

    if (event.description) {
      item.title = event.description;
    }

    eventsBox.appendChild(item);
  }

  renderCalendar();
}

// 달력 날짜 생성
function renderCalendar() {
  monthTitle.textContent = `${year}년 ${month}월`;
  days.replaceChildren();

  const firstDay = new Date(year, month - 1, 1).getDay();
  const lastDay = new Date(year, month, 0).getDate();

  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement("span");
    days.appendChild(empty);
  }

  for (let day = 1; day <= lastDay; day++) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = day;

    const hasEvent = events.some(
      event => event.date === formatDate(day)
    );

    if (hasEvent) {
      button.classList.add("has-event");
    }

    if (day === selectedDay) {
      button.classList.add("selected");
    }

    button.addEventListener("click", () => {
      showEvents(day);
    });

    days.appendChild(button);
  }
}

// 학교명이 같은 학교가 여러 개일 때 선택
function showSchoolChoices(schools) {
  schoolChoices.hidden = false;
  schoolChoices.replaceChildren();

  for (const school of schools) {
    const button = document.createElement("button");
    button.type = "button";

    button.textContent =
      `${school.name} (${school.address})`;

    button.addEventListener("click", () => {
      selectedSchool = school;
      schoolChoices.hidden = true;
      loadSchedule();
    });

    schoolChoices.appendChild(button);
  }
}

// Supabase 함수를 호출하여 일정 불러오기
async function loadSchedule() {
  const currentRequest = ++requestId;
  const classroomId = classSelect.value;

  events = [];
  renderCalendar();
  eventsBox.textContent = "일정을 불러오는 중...";
  schoolChoices.hidden = true;

  if (!classroomId) {
    status.textContent = "먼저 학급을 생성해 주세요.";
    eventsBox.textContent = "";
    return;
  }

  status.textContent = "나이스 학사일정을 불러오는 중...";

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

    if (currentRequest !== requestId) return;

    if (error) {
      let message = error.message;

      try {
        const body = await error.context?.json();
        message = body?.message || message;
      } catch {
        // 서버 응답을 JSON으로 읽을 수 없는 경우
      }

      throw new Error(message);
    }

    if (data.status === "choose-school") {
      status.textContent =
        "같은 이름의 학교가 있어요. 정확한 학교를 선택해 주세요.";

      eventsBox.textContent = "";
      showSchoolChoices(data.schools);
      return;
    }

    if (data.status !== "ok") {
      throw new Error("학사일정을 확인할 수 없습니다.");
    }

    events = data.events;

    status.textContent =
      `${data.school.name} · ${events.length}개의 학사일정`;

    showEvents(selectedDay);

  } catch (error) {
    if (currentRequest !== requestId) return;

    console.error("나이스 연동 오류:", error);
    status.textContent = error.message;
    eventsBox.textContent = "일정을 불러오지 못했어요.";
  }
}

// 로그인한 관리자의 학급 가져오기
async function loadClasses() {
  const { data: auth, error: authError } =
    await supabase.auth.getUser();

  if (authError || !auth.user) {
    status.textContent = "로그인 후 이용해 주세요.";
    return;
  }

  const { data, error } = await supabase
    .from("checkin_classrooms")
    .select("id, school_name")
    .eq("owner_id", auth.user.id)
    .order("created_at", { ascending: true });

  if (error) {
    status.textContent = "학급을 불러오지 못했어요.";
    console.error(error);
    return;
  }

  classSelect.replaceChildren();

  for (const classroom of data || []) {
    const option = document.createElement("option");
    option.value = classroom.id;
    option.textContent =
      classroom.school_name || "학교명 없음";

    classSelect.appendChild(option);
  }

  if (!data?.length) {
    status.textContent = "생성한 학급이 없습니다.";
    return;
  }

  await loadSchedule();
}

// 학급 변경
classSelect.addEventListener("change", () => {

  console.log("학급 선택:", document.getElementById("neisClassSelect"));
  console.log("이전 달:", document.getElementById("neisPrev"));
  console.log("다음 달:", document.getElementById("neisNext"));

  selectedSchool = null;
  loadSchedule();
});

// 이전 달
$("neisPrev").addEventListener("click", () => {
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
$("neisNext").addEventListener("click", () => {
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

// 초기 실행
renderCalendar();
loadClasses();

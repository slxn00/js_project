// 관리자 화면의 학사일정 달력: 월 이동과 날짜 선택을 지원합니다.
// 임의의 학사일정은 만들지 않으며, 실제 일정 데이터 저장은 추후 Supabase와 연동합니다.
const monthTitle = document.querySelector('#calendarMonth');
const daysContainer = document.querySelector('#calendarDays');
const chosenDate = document.querySelector('#calendarSelectedDate');
const dayEvents = document.querySelector('#calendarDayEvents');
const today = new Date();
const todayKey = [today.getFullYear(), today.getMonth(), today.getDate()].join('-');
let viewYear = today.getFullYear();
let viewMonth = today.getMonth();
let selectedDay = today.getDate();

function renderCalendar() {
  if (!monthTitle || !daysContainer) return;
  monthTitle.textContent = `${viewYear}년 ${viewMonth + 1}월`;
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const lastDay = new Date(viewYear, viewMonth + 1, 0).getDate();
  daysContainer.replaceChildren();

  for (let i = 0; i < firstWeekday; i++) {
    const empty = document.createElement('span');
    empty.className = 'calendar-empty';
    empty.setAttribute('aria-hidden', 'true');
    daysContainer.append(empty);
  }

  for (let day = 1; day <= lastDay; day++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'calendar-day';
    button.textContent = String(day);
    button.setAttribute('aria-label', `${viewYear}년 ${viewMonth + 1}월 ${day}일`);
    const key = [viewYear, viewMonth, day].join('-');
    if (key === todayKey) button.classList.add('is-today');
    if (day === selectedDay) button.classList.add('is-selected');
    button.setAttribute('aria-pressed', String(day === selectedDay));
    button.addEventListener('click', () => {
      selectedDay = day;
      renderCalendar();
    });
    daysContainer.append(button);
  }

  chosenDate.textContent = `${viewYear}년 ${viewMonth + 1}월 ${selectedDay}일`;
  dayEvents.textContent = '아직 등록된 학사일정이 없어요.';
}

function moveMonth(offset) {
  const date = new Date(viewYear, viewMonth + offset, 1);
  viewYear = date.getFullYear();
  viewMonth = date.getMonth();
  selectedDay = Math.min(selectedDay, new Date(viewYear, viewMonth + 1, 0).getDate());
  renderCalendar();
}

document.querySelector('#calendarPrev')?.addEventListener('click', () => moveMonth(-1));
document.querySelector('#calendarNext')?.addEventListener('click', () => moveMonth(1));
renderCalendar();

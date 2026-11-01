import { createCalendarStore, calendarDayKind, eventRange, isoDate, normalizedDate, todayISO } from './calendar.js';

export function createAdminCalendar(client) {
  const $ = id => document.getElementById(id);
  const clone = id => $(id).content.firstElementChild.cloneNode(true);
  const store = createCalendarStore(client);
  const panel = $('adminCalendar');
  const days = $('calendarDays');
  const tooltip = $('calendarTooltip');
  const tooltipEvents = $('calendarTooltipEvents');
  const menu = $('calendarContextMenu');
  const menuEvents = $('calendarContextEvents');
  const status = $('calendarStatus');
  const choices = $('neisSchoolChoices');
  const editor = $('calendarEditor');
  const form = $('calendarPeriodForm');
  const name = $('periodEventName');
  const start = $('periodEventStart');
  const end = $('periodEventEnd');
  const description = $('periodEventDescription');
  const error = $('periodEventError');
  const submit = form.querySelector('[type="submit"]');
  let [year, month, selectedDay] = todayISO().split('-').map(Number);
  let classroom = null;
  let selectedSchool = null;
  let entries = [];
  let request = 0;
  let saving = false;
  let deleting = false;
  let editingEvent = null;
  let menuDate = null;
  let menuAnchor = null;
  let hoverAnchor = null;
  let hoverTimer = null;
  const selectedDate = () => isoDate(year, month, selectedDay);
  const lastDay = () => new Date(year, month, 0).getDate();

  const eventsOn = date => entries.filter(event => event.start <= date && event.end >= date);

  function positionPopup(popup, x, y, above = y) {
    popup.hidden = false;
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    const left = Math.max(8, Math.min(x, window.innerWidth - width - 8));
    const top = y + height <= window.innerHeight - 8 ? y : Math.max(8, above - height - 8);
    // CSS controls appearance; these variables only contain measured screen coordinates.
    popup.style.setProperty('--popup-x', `${left}px`);
    popup.style.setProperty('--popup-y', `${top}px`);
  }

  function hideTooltip() {
    window.clearTimeout(hoverTimer);
    tooltip.hidden = true;
    hoverAnchor?.removeAttribute('aria-describedby');
    hoverAnchor = null;
  }

  function showTooltip(anchor, date, events = eventsOn(date)) {
    window.clearTimeout(hoverTimer);
    if (!menu.hidden || !events.length) { hideTooltip(); return; }
    hoverAnchor?.removeAttribute('aria-describedby');
    hoverAnchor = anchor;
    anchor.setAttribute('aria-describedby', 'calendarTooltip');
    $('calendarTooltipTitle').textContent = date;
    const rows = events.map(event => {
      const row = clone('calendarHoverEventTemplate');
      row.querySelector('strong').textContent = event.name;
      row.querySelector('.calendar-hover-dates').textContent = eventRange(event);
      const detail = row.querySelector('.calendar-hover-description');
      detail.textContent = event.description;
      detail.hidden = !event.description;
      return row;
    });
    tooltipEvents.replaceChildren(...rows);
    const rect = anchor.getBoundingClientRect();
    positionPopup(tooltip, rect.left, rect.bottom + 8, rect.top);
  }

  function bindTooltip(anchor, date, events) {
    anchor.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'touch') showTooltip(anchor, date, events);
    });
    anchor.addEventListener('pointerleave', () => { hoverTimer = window.setTimeout(hideTooltip, 120); });
    anchor.addEventListener('focus', () => showTooltip(anchor, date, events));
    anchor.addEventListener('blur', hideTooltip);
  }
  tooltip.addEventListener('pointerenter', () => window.clearTimeout(hoverTimer));
  tooltip.addEventListener('pointerleave', hideTooltip);

  function closeMenu(restoreFocus = false) {
    menu.hidden = true;
    if (restoreFocus && menuAnchor?.isConnected) menuAnchor.focus();
    menuAnchor = null;
  }

  function openContextMenu(event, date, events = eventsOn(date)) {
    event.preventDefault();
    if (!classroom || saving || deleting) return;
    hideTooltip();
    const custom = events.filter(item => item.source === 'custom');
    if (!custom.length) { closeMenu(); openEditor(date); return; }
    menuDate = date;
    menuAnchor = event.currentTarget;
    menuEvents.replaceChildren(...custom.map(item => {
      const row = clone('calendarContextEventTemplate');
      row.setAttribute('aria-label', item.name);
      row.querySelector('p').textContent = item.name;
      row.querySelector('[data-edit]').addEventListener('click', () => {
        closeMenu();
        openEditor(date, item);
      });
      row.querySelector('[data-delete]').addEventListener('click', () => {
        closeMenu();
        void deleteEvent(item);
      });
      return row;
    }));
    const rect = menuAnchor.getBoundingClientRect();
    positionPopup(menu, event.clientX || rect.left, event.clientY || rect.bottom);
    menu.querySelector('[role="menuitem"]').focus();
  }

  $('calendarContextAdd').addEventListener('click', () => { closeMenu(); openEditor(menuDate); });
  document.addEventListener('pointerdown', event => {
    if (!menu.contains(event.target)) closeMenu();
    if (!tooltip.contains(event.target) && !days.contains(event.target)) hideTooltip();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeMenu(true); hideTooltip(); }
  });
  menu.addEventListener('keydown', event => {
    const buttons = [...menu.querySelectorAll('[role="menuitem"]')];
    const index = buttons.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
        (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    } else if (event.key === 'Tab') closeMenu();
  });
  const dismissPopups = () => { closeMenu(); hideTooltip(); };
  window.addEventListener('resize', dismissPopups);
  window.addEventListener('blur', dismissPopups);
  window.addEventListener('scroll', event => {
    if (!tooltip.contains(event.target) && !menu.contains(event.target)) dismissPopups();
  }, true);

  function selectDay(day) {
    selectedDay = day;
    days.querySelectorAll('.schedule-day').forEach(cell => {
      const selected = Number(cell.dataset.day) === day;
      cell.classList.toggle('selected', selected);
      cell.setAttribute('aria-pressed', String(selected));
    });
  }

  function renderCalendar() {
    dismissPopups();
    $('calendarMonth').textContent = `${year}년 ${month}월`;
    days.replaceChildren();
    const firstWeekday = new Date(year, month - 1, 1).getDay();
    const count = lastDay();
    const monthStart = isoDate(year, month, 1);
    const monthEnd = isoDate(year, month, count);
    const weeks = Math.ceil((firstWeekday + count) / 7);
    days.dataset.weeks = weeks;
    for (let index = 0; index < weeks; index++) {
      const week = clone('calendarWeekTemplate');
      const bars = week.querySelector('.schedule-bars');
      const weekStart = index * 7 - firstWeekday + 1;
      for (let col = 0; col < 7; col++) {
        const day = weekStart + col;
        if (day < 1 || day > count) {
          week.insertBefore(clone('calendarBlankTemplate'), bars);
          continue;
        }
        const cell = clone('calendarDayTemplate');
        const date = isoDate(year, month, day);
        cell.dataset.day = day;
        cell.dataset.kind = calendarDayKind(date, entries);
        cell.querySelector('span').textContent = day;
        cell.classList.toggle('selected', day === selectedDay);
        cell.setAttribute('aria-pressed', String(day === selectedDay));
        cell.setAttribute('aria-label', `${year}년 ${month}월 ${day}일${cell.dataset.kind === 'holiday' ? ' (공휴일)' : ''}`);
        if (date === todayISO()) cell.setAttribute('aria-current', 'date');
        cell.addEventListener('click', () => { selectDay(day); showTooltip(cell, date); });
        cell.addEventListener('contextmenu', event => openContextMenu(event, date));
        bindTooltip(cell, date);
        week.insertBefore(cell, bars);
      }
      const segments = entries.filter(event => event.start <= monthEnd && event.end >= monthStart)
        .map(event => ({
          event,
          start: Math.max(1, weekStart, event.start >= monthStart ? Number(event.start.slice(8)) : 1),
          end: Math.min(count, weekStart + 6, event.end <= monthEnd ? Number(event.end.slice(8)) : count),
        })).filter(item => item.start <= item.end)
        .sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
      const occupied = [];
      for (const segment of segments) {
        const first = segment.start - weekStart + 1;
        const last = segment.end - weekStart + 1;
        let lane = 0;
        while (occupied[lane]?.some(([a, b]) => first <= b && last >= a)) lane++;
        // 날짜에 마우스를 올리면 막대 개수와 관계없이 모든 일정을 볼 수 있습니다.
        if (lane >= 4) continue;
        occupied[lane] ||= [];
        occupied[lane].push([first, last]);
        const bar = clone('calendarBarTemplate');
        const begins = segment.event.start === isoDate(year, month, segment.start);
        const ends = segment.event.end === isoDate(year, month, segment.end);
        const shape = begins && ends ? 'single' : begins ? 'starts' : ends ? 'ends' : 'middle';
        bar.classList.add(shape, `column-${first}`, `end-${last}`, `lane-${lane + 1}`);
        bar.textContent = segment.event.name;
        const date = isoDate(year, month, segment.start);
        bar.setAttribute('aria-label', `${segment.event.name} (${eventRange(segment.event)})`);
        bindTooltip(bar, date, [segment.event]);
        bar.addEventListener('click', () => { selectDay(segment.start); showTooltip(bar, date, [segment.event]); });
        bar.addEventListener('contextmenu', event => openContextMenu(event, date, [segment.event]));
        bars.append(bar);
      }
      days.append(week);
    }
  }

  async function loadSchedule() {
    if (!classroom) return;
    const token = ++request;
    const current = classroom;
    entries = [];
    choices.hidden = true;
    renderCalendar();
    days.setAttribute('aria-busy', 'true');
    status.textContent = '학사일정을 불러오고 있어요...';
    const [custom, school] = await Promise.allSettled([
      store.getEvents(current.id, { start: isoDate(year, month, 1), end: isoDate(year, month, lastDay()) }),
      client.functions.invoke('neis-calendar', {
        body: { classroomId: current.id, year, month, ...(selectedSchool || {}) },
      }),
    ]);
    if (token !== request) return;
    const messages = [];
    if (custom.status === 'fulfilled') entries = custom.value;
    else messages.push(custom.reason.message);
    if (school.status === 'fulfilled' && !school.value.error && school.value.data?.status === 'ok') {
      entries.push(...(school.value.data.events || []).map(event => ({
        name: event.name, description: event.description || '', source: 'neis',
        start: normalizedDate(event.date), end: normalizedDate(event.date),
        isHoliday: event.isHoliday,
      })).filter(event => event.start));
    } else if (school.status === 'fulfilled' && school.value.data?.status === 'choose-school') {
      choices.replaceChildren();
      for (const school of school.value.data.schools || []) {
        const button = clone('calendarSchoolTemplate');
        button.textContent = `${school.name} (${school.address || '주소 없음'})`;
        button.addEventListener('click', () => {
          selectedSchool = { officeCode: school.officeCode, schoolCode: school.schoolCode };
          void loadSchedule();
        });
        choices.append(button);
      }
      choices.hidden = false;
      messages.push('나이스 일정을 확인할 학교를 선택해 주세요.');
    } else {
      messages.push('나이스 일정을 불러오지 못했어요. 직접 등록한 일정은 별도로 표시됩니다.');
    }
    days.setAttribute('aria-busy', 'false');
    status.textContent = messages.join(' ') || `${current.school.name} · 직접 등록한 일정은 학생에게도 표시됩니다.`;
    renderCalendar();
  }

  function openEditor(date = selectedDate(), event = null) {
    if (!classroom || saving || deleting || editor.open) return;
    dismissPopups();
    editingEvent = event;
    form.reset();
    form.querySelectorAll('[aria-invalid]').forEach(input => input.removeAttribute('aria-invalid'));
    error.textContent = '';
    $('calendarEditorTitle').textContent = event ? '학사일정 수정' : '학사일정 추가';
    submit.textContent = event ? '수정 내용 저장' : '일정 등록하기';
    name.value = event?.name || '';
    start.value = event?.start || date;
    end.value = event?.end || date;
    description.value = event?.description || '';
    editor.showModal();
    name.focus();
  }

  $('openCustomEventModal').addEventListener('click', () => openEditor());
  $('closeCalendarEditor').addEventListener('click', () => { if (!saving) editor.close(); });
  editor.addEventListener('click', event => { if (event.target === editor && !saving) editor.close(); });
  editor.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  [name, start, end].forEach(input => input.addEventListener('input', () => {
    input.removeAttribute('aria-invalid');
    error.textContent = '';
  }));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!classroom || saving) return;
    const required = [name, start, end];
    required.forEach(input => input.setAttribute('aria-invalid', String(!input.value.trim())));
    const invalid = required.find(input => !input.value.trim());
    if (invalid || start.value > end.value) {
      const target = invalid || end;
      target.setAttribute('aria-invalid', 'true');
      target.focus();
      error.textContent = invalid ? '필수 항목을 입력해 주세요.' : '종료일은 시작일보다 빠를 수 없어요.';
      return;
    }
    const current = classroom;
    const target = editingEvent;
    const value = { name: name.value, start: start.value, end: end.value, description: description.value };
    saving = true;
    submit.disabled = true;
    $('closeCalendarEditor').disabled = true;
    error.textContent = '저장하고 있어요...';
    try {
      if (target) await store.updateEvent(current.id, target.id, value);
      else await store.addEvent(current, value);
      if (current.id !== classroom?.id) return;
      editor.close();
      [year, month, selectedDay] = value.start.split('-').map(Number);
      await loadSchedule();
    } catch (failure) {
      error.textContent = `${target ? '수정' : '등록'}에 실패했어요: ${failure.message}`;
    } finally {
      saving = false;
      submit.disabled = false;
      $('closeCalendarEditor').disabled = false;
    }
  });

  async function deleteEvent(event) {
    if (!classroom || saving || deleting || !window.confirm(`'${event.name}' 일정을 삭제할까요?`)) return;
    const currentId = classroom.id;
    deleting = true;
    status.textContent = '일정을 삭제하고 있어요...';
    try {
      await store.deleteEvent(currentId, event.id);
      if (classroom?.id === currentId) await loadSchedule();
    } catch (failure) {
      if (classroom?.id === currentId) status.textContent = `삭제에 실패했어요: ${failure.message}`;
    } finally {
      deleting = false;
    }
  }

  for (const [id, offset] of [['calendarPrev', -1], ['calendarNext', 1]]) {
    $(id).addEventListener('click', () => {
      const date = new Date(year, month - 1 + offset, 1);
      year = date.getFullYear();
      month = date.getMonth() + 1;
      selectedDay = Math.min(selectedDay, lastDay());
      void loadSchedule();
    });
  }
  $('calendarRefresh').addEventListener('click', () => { void loadSchedule(); });

  return {
    setClassroom(value) {
      if (classroom?.id === value?.id) return;
      ++request;
      classroom = value || null;
      entries = [];
      selectedSchool = null;
      dismissPopups();
      if (editor.open) editor.close();
      panel.hidden = !classroom;
      if (!classroom) return;
      $('adminCalendarTitle').textContent = `${classroom.school.name} 학사일정`;
      void loadSchedule();
    },
  };
}

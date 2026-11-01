const DAY_MS = 86400000;
const schoolDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function todayISO(now = new Date()) {
  const parts = Object.fromEntries(schoolDate.formatToParts(now).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function normalizedDate(value) {
  const raw = String(value ?? '').replaceAll('-', '').slice(0, 8);
  if (!/^\d{8}$/.test(raw)) return '';
  const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date ? date : '';
}

export function eventTiming(event, today = todayISO()) {
  const days = Math.round((Date.parse(`${event.start}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
  if (days > 0) return { label: `D-${days}`, state: 'upcoming' };
  if (days === 0) return { label: 'D-DAY', state: 'today' };
  if (today <= event.end) return { label: '진행 중', state: 'ongoing' };
  return { label: `D+${Math.abs(days)}`, state: 'past' };
}

export function eventRange(event) {
  return event.start === event.end ? event.start : `${event.start} ~ ${event.end}`;
}

function calendarError(error) {
  if (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error?.code)) {
    return new Error('학사일정 데이터베이스가 준비되지 않았어요. 관리자에게 문의해 주세요.');
  }
  if (error?.code === '42501') return new Error('이 학급의 일정을 변경할 권한이 없어요.');
  return new Error(error?.message || '학사일정을 불러오지 못했어요. 다시 시도해 주세요.');
}

function eventValues(event) {
  if (!event.name.trim() || event.name.trim().length > 100 || event.description.length > 500 ||
      !normalizedDate(event.start) || !normalizedDate(event.end) || event.start > event.end) {
    throw new Error('일정명과 시작일·종료일을 확인해 주세요.');
  }
  return {
    name: event.name.trim(), description: event.description.trim(),
    event_date: event.start, end_date: event.end,
  };
}

export function createCalendarStore(client) {
  return {
    async getEvents(classroomId, { start, end } = {}) {
      let query = client.from('custom_calendar_events')
        .select('id,event_date,end_date,name,description').eq('classroom_id', classroomId);
      if (start) query = query.gte('end_date', start);
      if (end) query = query.lte('event_date', end);
      const { data, error } = await query.order('event_date').order('id');
      if (error) throw calendarError(error);
      return (data || []).map(row => ({
        id: row.id, name: row.name, description: row.description || '', source: 'custom',
        start: normalizedDate(row.event_date), end: normalizedDate(row.end_date || row.event_date),
      })).filter(event => event.start && event.end && event.start <= event.end);
    },
    async addEvent(classroom, event) {
      const values = eventValues(event);
      const { data, error } = await client.from('custom_calendar_events').insert({
        classroom_id: classroom.id, created_by: classroom.ownerId,
        ...values,
      }).select('id').single();
      if (error) throw calendarError(error);
      return data;
    },
    async updateEvent(classroomId, eventId, event) {
      const values = eventValues(event);
      const { data, error } = await client.from('custom_calendar_events').update(values)
        .eq('classroom_id', classroomId).eq('id', eventId).select('id');
      if (error) throw calendarError(error);
      if (!data?.length) throw new Error('일정이 이미 삭제되었거나 수정 권한이 없어요.');
      return data[0];
    },
    async deleteEvent(classroomId, eventId) {
      const { data, error } = await client.from('custom_calendar_events').delete()
        .eq('classroom_id', classroomId).eq('id', eventId).select('id');
      if (error) throw calendarError(error);
      if (!data?.length) throw new Error('일정이 이미 삭제되었거나 삭제 권한이 없어요.');
    },
  };
}

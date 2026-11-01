import test from 'node:test';
import assert from 'node:assert/strict';
import { createCalendarStore, eventTiming, eventRange, normalizedDate, todayISO } from '../src/js/calendar.js';

const event = { start: '2026-11-03', end: '2026-11-05' };

test('한국 자정 전후와 연도 경계에서 학교 날짜가 바뀐다', () => {
  assert.equal(todayISO(new Date('2026-11-01T14:59:59Z')), '2026-11-01');
  assert.equal(todayISO(new Date('2026-11-01T15:00:00Z')), '2026-11-02');
  assert.equal(todayISO(new Date('2026-12-31T15:00:00Z')), '2027-01-01');
});

test('예정, 당일, 기간 중, 종료 상태의 D-day를 계산한다', () => {
  assert.deepEqual(eventTiming(event, '2026-11-01'), { label: 'D-2', state: 'upcoming' });
  assert.deepEqual(eventTiming(event, '2026-11-03'), { label: 'D-DAY', state: 'today' });
  assert.deepEqual(eventTiming(event, '2026-11-04'), { label: '진행 중', state: 'ongoing' });
  assert.equal(eventTiming(event, '2026-11-05').state, 'ongoing');
  assert.deepEqual(eventTiming(event, '2026-11-06'), { label: 'D+3', state: 'past' });
  assert.equal(eventTiming({ start: '2027-01-01', end: '2027-01-01' }, '2026-12-31').label, 'D-1');
  assert.equal(eventTiming({ start: '2028-03-01', end: '2028-03-01' }, '2028-02-28').label, 'D-2');
});

test('날짜를 정규화하고 잘못된 날짜는 제외한다', () => {
  assert.equal(normalizedDate('20261103'), '2026-11-03');
  assert.equal(normalizedDate('2026-11-03'), '2026-11-03');
  for (const value of [null, '', '2026-02-29', '2026-13-01', 'not-a-date']) assert.equal(normalizedDate(value), '');
  assert.equal(eventRange(event), '2026-11-03 ~ 2026-11-05');
  assert.equal(eventRange({ start: '2026-11-03', end: '2026-11-03' }), '2026-11-03');
});

function fixture(result = { data: [], error: null }) {
  const calls = [];
  const query = {};
  for (const method of ['select', 'eq', 'gte', 'lte', 'order', 'insert', 'delete', 'single']) {
    query[method] = (...args) => { calls.push([method, ...args]); return query; };
  }
  query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  const client = { from(table) { calls.push(['from', table]); return query; } };
  return { store: createCalendarStore(client), calls };
}

test('일정 조회는 학급과 겹치는 기간으로 제한하고 단일 일정을 정규화한다', async () => {
  const f = fixture({ data: [
    { id: 'a', event_date: '2026-10-30', end_date: '2026-11-03', name: '기간 일정' },
    { id: 'b', event_date: '2026-11-05', end_date: null, name: '하루 일정' },
    { id: 'c', event_date: '2026-11-06', end_date: '2026-11-02', name: '잘못된 기간' },
  ], error: null });
  const events = await f.store.getEvents('class-a', { start: '2026-11-01', end: '2026-11-30' });
  assert.deepEqual(f.calls.filter(call => ['eq', 'gte', 'lte'].includes(call[0])), [
    ['eq', 'classroom_id', 'class-a'], ['gte', 'end_date', '2026-11-01'], ['lte', 'event_date', '2026-11-30'],
  ]);
  assert.equal(events.length, 2);
  assert.equal(events[1].end, '2026-11-05');
});

test('조회 실패와 미설정 DB를 빈 일정으로 숨기지 않는다', async () => {
  await assert.rejects(fixture({ data: null, error: { code: 'PGRST205' } }).store.getEvents('a'), /데이터베이스/);
  await assert.rejects(fixture({ data: null, error: { message: 'network unavailable' } }).store.getEvents('a'), /network/);
  await assert.rejects(fixture({ data: null, error: { code: '42501' } }).store.deleteEvent('a', 'b'), /권한/);
});

test('일정 저장은 공백을 정리하며 날짜 역전과 빈 제목을 전송하지 않는다', async () => {
  const f = fixture({ data: { id: 'saved' }, error: null });
  const classroom = { id: 'class-a', ownerId: 'teacher-a' };
  assert.deepEqual(await f.store.addEvent(classroom, { ...event, name: ' 시험 ', description: ' 준비물 ' }), { id: 'saved' });
  assert.deepEqual(f.calls.find(call => call[0] === 'insert')[1], {
    classroom_id: 'class-a', created_by: 'teacher-a', name: '시험', description: '준비물',
    event_date: event.start, end_date: event.end,
  });
  const invalid = fixture();
  await assert.rejects(invalid.store.addEvent(classroom, { ...event, name: ' ', description: '' }), /확인/);
  await assert.rejects(invalid.store.addEvent(classroom, { ...event, end: '2026-11-01', name: '시험', description: '' }), /확인/);
  assert.equal(invalid.calls.length, 0);
});

test('삭제는 학급과 일정 ID를 모두 제한하며 권한 없는 삭제를 성공으로 표시하지 않는다', async () => {
  const f = fixture({ data: [{ id: 'event-a' }], error: null });
  await f.store.deleteEvent('class-a', 'event-a');
  assert.deepEqual(f.calls.filter(call => call[0] === 'eq'), [
    ['eq', 'classroom_id', 'class-a'], ['eq', 'id', 'event-a'],
  ]);
  await assert.rejects(fixture().store.deleteEvent('other-class', 'event-a'), /삭제 권한/);
});

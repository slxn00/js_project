const pad = number => String(number).padStart(2, '0');

export function parseDeadline({ hour, minute, second, precision }) {
    if (!['minute', 'second'].includes(precision)) throw new Error('마감 기준을 선택해 주세요.');
    const values = [hour, minute, precision === 'minute' ? '0' : second].map(value => String(value ?? '').trim());
    if (values.some(value => !/^\d{1,2}$/.test(value)) || Number(values[0]) > 23 || values.slice(1).some(value => Number(value) > 59)) {
        throw new Error('시는 0~23, 분과 초는 0~59 사이의 정수로 모두 입력해 주세요.');
    }
    return { hour: Number(values[0]), minute: Number(values[1]), second: Number(values[2]), precision };
}

export function deadlineSummary(deadline) {
    if (!deadline) return '등교시간 미설정';
    const [hour, minute, second] = deadline.time.split(':').map(Number);
    const lastSecond = hour * 3600 + minute * 60 + (deadline.precision === 'minute' ? 59 : second);
    const clock = value => `${pad(Math.floor(value / 3600))}:${pad(Math.floor(value % 3600 / 60))}:${pad(value % 60)}`;
    return `${clock(lastSecond)}까지 정상 등교${lastSecond < 86399 ? `\n${clock(lastSecond + 1)}부터 지각` : ''}`;
}

export function createAttendanceSettings(dialog, save) {
    const $ = selector => dialog.querySelector(selector);
    const form = $('form');
    const fields = [$('#attendanceHour'), $('#attendanceMinute'), $('#attendanceSecond')];
    const error = $('#attendanceSettingsError');
    const submit = $('[type="submit"]');
    let classroom = null;
    let busy = false;
    const precision = () => $('[name="deadlinePrecision"]:checked')?.value;
    const values = () => parseDeadline({ hour: fields[0].value, minute: fields[1].value, second: fields[2].value, precision: precision() });
    function preview() {
        const exact = precision() === 'second';
        $('#attendanceSecondGroup').hidden = !exact;
        fields[2].disabled = !exact;
        fields[2].required = exact;
        try {
            const value = values();
            $('#attendanceDeadlinePreview').textContent = deadlineSummary({ time: [value.hour, value.minute, value.second].map(pad).join(':'), precision: value.precision });
        } catch { $('#attendanceDeadlinePreview').textContent = '등교시간과 마감 기준을 입력해 주세요.'; }
    }
    function close() { if (!busy) dialog.close(); }
    $('[data-close]').addEventListener('click', close);
    $('[data-cancel]').addEventListener('click', close);
    dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.addEventListener('close', () => { classroom = null; });
    form.addEventListener('input', () => { error.textContent = ''; preview(); });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (busy || !classroom) return;
        let value;
        try { value = values(); }
        catch (failure) { error.textContent = failure.message; form.reportValidity(); return; }
        busy = true;
        error.textContent = '';
        form.setAttribute('aria-busy', 'true');
        [...form.elements].forEach(element => { element.disabled = true; });
        submit.textContent = '저장 중...';
        try { await save(classroom.id, value); dialog.close(); }
        catch (failure) { error.textContent = failure.message || '등교시간을 저장하지 못했어요. 다시 시도해 주세요.'; }
        finally {
            busy = false;
            form.setAttribute('aria-busy', 'false');
            [...form.elements].forEach(element => { element.disabled = false; });
            submit.textContent = '저장하기';
            preview();
        }
    });
    return item => {
        if (busy) return;
        form.reset();
        classroom = item;
        error.textContent = '';
        $('#attendanceSettingsClass').textContent = `${item.className} · ${item.school.name}`;
        if (item.attendanceDeadline) {
            const deadline = item.attendanceDeadline;
            deadline.time.split(':').forEach((value, index) => { fields[index].value = Number(value); });
            $(`[name="deadlinePrecision"][value="${deadline.precision}"]`).checked = true;
        }
        preview();
        dialog.showModal();
    };
}

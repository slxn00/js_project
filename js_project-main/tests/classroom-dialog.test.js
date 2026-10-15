import test from 'node:test'
import assert from 'node:assert/strict'
import { createClassroomDialog } from '../src/js/classroom-dialog.js'

function fixture() {
    const listeners = new Map()
    const make = () => ({
        value: '', textContent: '', hidden: false, disabled: false,
        classList: { toggle() {} }, focus() {}, select() {},
        addEventListener(type, callback) { listeners.set(this.key + ':' + type, callback) },
    })
    const nodes = Object.fromEntries(['form', '[data-title]', '[data-description]', '[data-name-group]', 'input', '[role="status"]', '[type="submit"]', '[data-cancel]'].map(key => [key, { ...make(), key }]))
    const dialog = {
        ...make(), key: 'dialog', open: false,
        querySelector: key => nodes[key],
        showModal() { this.open = true },
        close() { this.open = false; listeners.get('dialog:close')?.() },
    }
    const open = createClassroomDialog(dialog)
    const submit = () => listeners.get('form:submit')({ preventDefault() {} })
    return { dialog, nodes, listeners, open, submit }
}

test('삭제 확인창을 취소하면 삭제를 실행하지 않는다', () => {
    const f = fixture()
    let removed = false
    f.open({ title: '학생 삭제', description: '확인', submit: '삭제', action: () => { removed = true } })
    f.listeners.get('[data-cancel]:click')()
    assert.equal(removed, false)
    assert.equal(f.dialog.open, false)
})

test('이름 수정은 공백을 검증하고 저장 오류가 나면 창과 이름을 유지한다', async () => {
    const f = fixture()
    const names = []
    f.open({ title: '이름 수정', name: '기존 이름', submit: '저장', action: async name => { names.push(name); throw new Error('권한 없음') } })
    f.nodes.input.value = ' '
    await f.submit()
    assert.deepEqual(names, [])
    assert.match(f.nodes['[role="status"]'].textContent, /성함/)
    f.nodes.input.value = ' 새 이름 '
    await f.submit()
    assert.deepEqual(names, ['새 이름'])
    assert.equal(f.dialog.open, true)
    assert.equal(f.nodes['[role="status"]'].textContent, '권한 없음')
    assert.equal(f.nodes['[type="submit"]'].disabled, false)
})

test('저장 중 중복 제출과 Esc 취소를 막고 성공한 뒤 확인창을 닫는다', async () => {
    const f = fixture()
    let resolve
    let calls = 0
    f.open({ title: '학급 삭제', submit: '삭제', action: () => { calls++; return new Promise(done => { resolve = done }) } })
    const pending = f.submit()
    await f.submit()
    let prevented = false
    f.listeners.get('dialog:cancel')({ preventDefault() { prevented = true } })
    assert.equal(calls, 1)
    assert.equal(prevented, true)
    assert.equal(f.nodes['[data-cancel]'].disabled, true)
    resolve()
    await pending
    assert.equal(f.dialog.open, false)
})

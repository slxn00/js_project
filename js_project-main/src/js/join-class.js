const dialog = document.querySelector('#joinClassDialog')
const openButton = document.querySelector('#joinClassButton')
const closeButton = document.querySelector('#closeJoinClass')
const form = document.querySelector('#joinClassForm')
const nameInput = document.querySelector('#joinName')
const digits = [...document.querySelectorAll('.join-code-digit')]
const status = document.querySelector('#joinClassStatus')
const summary = document.querySelector('#joinClassSummary')
const submitButton = form.querySelector('button[type="submit"]')
let submitting = false

function clearError() {
    status.textContent = ''
    ;[nameInput, ...digits].forEach(input => input.removeAttribute('aria-invalid'))
}

function fillCode(value, startIndex) {
    const code = value.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!code) return
    const start = code.length >= digits.length ? 0 : startIndex
    const characters = code.slice(0, digits.length - start)
    ;[...characters].forEach((character, index) => { digits[start + index].value = character })
    digits[Math.min(start + characters.length, digits.length - 1)].focus()
}

openButton.addEventListener('click', () => {
    if (openButton.dataset.hasClass === 'true') {
        summary.textContent = '학급이 있으면 안됩니다'
        summary.classList.add('is-error')
        summary.hidden = false
        return
    }
    clearError()
    dialog.showModal()
    nameInput.focus()
})
closeButton.addEventListener('click', () => dialog.close())
dialog.addEventListener('click', event => {
    if (event.target !== dialog) return
    const bounds = dialog.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close()
})
dialog.addEventListener('close', () => openButton.focus())
nameInput.addEventListener('input', clearError)

digits.forEach((input, index) => {
    input.addEventListener('focus', () => input.select())
    input.addEventListener('input', () => {
        clearError()
        const code = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
        input.value = code.slice(0, 1)
        if (code.length > 1) fillCode(code, index)
        else if (code && index < digits.length - 1) digits[index + 1].focus()
    })
    input.addEventListener('paste', event => {
        event.preventDefault()
        clearError()
        fillCode(event.clipboardData.getData('text'), index)
    })
    input.addEventListener('keydown', event => {
        if (event.key === 'Backspace' && !input.value && index > 0) {
            event.preventDefault()
            digits[index - 1].value = ''
            digits[index - 1].focus()
            clearError()
        } else if (event.key === 'ArrowLeft' && index > 0) {
            event.preventDefault(); digits[index - 1].focus()
        } else if (event.key === 'ArrowRight' && index < digits.length - 1) {
            event.preventDefault(); digits[index + 1].focus()
        }
    })
})

form.addEventListener('submit', async event => {
    event.preventDefault()
    if (submitting) return
    clearError()
    const name = nameInput.value.trim()
    const code = digits.map(input => input.value).join('')
    if (!name) {
        nameInput.setAttribute('aria-invalid', 'true')
        status.textContent = '성함을 입력해 주세요.'
        nameInput.focus()
        return
    }
    if (!/^[A-Z0-9]{5}$/.test(code)) {
        digits.filter(input => !input.value).forEach(input => input.setAttribute('aria-invalid', 'true'))
        status.textContent = '학급코드 5자리를 입력해 주세요.'
        ;(digits.find(input => !input.value) || digits[0]).focus()
        return
    }
    submitting = true
    submitButton.disabled = true
    submitButton.textContent = '입장 중…'
    ;[nameInput, ...digits].forEach(input => { input.disabled = true })
    try {
        const membership = await classrooms.joinClass({ name, code })
        summary.textContent = `${membership.name} · ${membership.className} 입장 완료`
        summary.classList.remove('is-error')
        summary.hidden = false
        dialog.close()
        window.dispatchEvent(new CustomEvent('classroom:joined', { detail: membership }))
    } catch (error) {
        status.textContent = error.message
    } finally {
        submitting = false
        submitButton.disabled = false
        submitButton.textContent = '입장'
        ;[nameInput, ...digits].forEach(input => { input.disabled = false })
    }
})
import { supabase } from './supabaseClient.js'
import { createClassroomStore } from './classroom-store.js'

const classrooms = createClassroomStore(supabase)

export function createClassroomDialog(dialog) {
    const form = dialog.querySelector('form')
    const title = dialog.querySelector('[data-title]')
    const description = dialog.querySelector('[data-description]')
    const nameGroup = dialog.querySelector('[data-name-group]')
    const name = dialog.querySelector('input')
    const status = dialog.querySelector('[role="status"]')
    const submit = dialog.querySelector('[type="submit"]')
    const cancel = dialog.querySelector('[data-cancel]')
    let action = null
    let busy = false

    cancel.addEventListener('click', () => dialog.close())
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault() })
    dialog.addEventListener('close', () => { action = null })
    form.addEventListener('submit', async event => {
        event.preventDefault()
        if (busy || !action) return
        status.textContent = ''
        if (!nameGroup.hidden && (!name.value.trim() || name.value.trim().length > 50)) {
            status.textContent = '성함을 1~50자로 입력해 주세요.'
            name.focus()
            return
        }
        busy = true
        submit.disabled = cancel.disabled = name.disabled = true
        try {
            await action(name.value.trim())
            dialog.close()
        } catch (error) {
            status.textContent = error.message || '변경하지 못했어요. 다시 시도해 주세요.'
        } finally {
            busy = false
            submit.disabled = cancel.disabled = name.disabled = false
        }
    })

    return options => {
        if (busy) return
        title.textContent = options.title
        description.textContent = options.description
        nameGroup.hidden = options.name === undefined
        name.value = options.name || ''
        submit.textContent = options.submit
        submit.classList.toggle('danger-button', options.name === undefined)
        status.textContent = ''
        action = options.action
        dialog.showModal()
        if (!nameGroup.hidden) { name.focus(); name.select() }
        else cancel.focus()
    }
}

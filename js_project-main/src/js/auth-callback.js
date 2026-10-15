export function getAuthCallbackError(location = window.location) {
    const url = new URL(location.href, location.origin)
    const fragment = new URLSearchParams(url.hash.slice(1))
    const code = url.searchParams.get('error_code') || url.searchParams.get('error') || fragment.get('error_code') || fragment.get('error')
    if (!code) return null
    return {
        code,
        message: url.searchParams.get('error_description') || fragment.get('error_description') || code,
    }
}

export function redirectAuthCallbackError(location = window.location) {
    const error = getAuthCallbackError(location)
    if (!error) return false
    const params = new URLSearchParams({ error: error.code, error_description: error.message })
    location.replace(`/login.html?${params}`)
    return true
}

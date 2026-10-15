import { supabase } from './supabaseClient.js'

export function showAuthStatus(error, success = false) {
    const status = document.querySelector('#auth-status')
    const messages = {
        invalid_credentials: '이메일 또는 비밀번호가 올바르지 않습니다.',
        email_not_confirmed: '이메일 인증을 완료한 뒤 로그인해 주세요.',
        over_email_send_rate_limit: '인증 메일 요청이 많습니다. 잠시 후 다시 시도해 주세요.',
        over_request_rate_limit: '요청이 많습니다. 잠시 후 다시 시도해 주세요.',
        otp_expired: '인증번호가 올바르지 않거나 만료되었습니다. 다시 발송해 주세요.',
        provider_disabled: '해당 소셜 로그인이 아직 활성화되지 않았습니다.',
    }
    let message = typeof error === 'string' ? error : messages[error?.code] || error?.message || '인증 요청에 실패했습니다. 다시 시도해 주세요.'
    if (error?.code === 'invalid_scope' && /account_email/i.test(message)) {
        message = '카카오 로그인에 필요한 이메일 동의항목(account_email)이 앱에서 허용되지 않았습니다. 카카오 개발자 콘솔의 동의항목과 앱 권한을 확인해 주세요.'
    } else if (error?.code === 'invalid_scope') {
        message = '카카오 로그인 동의항목 설정을 확인해 주세요. ' + message
    } else if (/invalid api key/i.test(message)) {
        message = '인증 서버의 API 키 설정을 확인해 주세요.'
    } else if (/failed to fetch|fetch failed|networkerror/i.test(message)) {
        message = '인증 서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.'
    }
    status.textContent = message
    status.className = `status-text ${success ? 'success' : 'error'}`
    status.hidden = !message
}

export function bindSocialAuth(button, provider, redirectPath) {
    if (!button) return
    button.addEventListener('click', async () => {
        if (button.disabled) return
        showAuthStatus('')
        button.disabled = true
        try {
            const { error } = await supabase.auth.signInWithOAuth({
                provider,
                options: { redirectTo: window.location.origin + redirectPath },
            })
            if (error) throw error
        } catch (error) {
            showAuthStatus(error)
        } finally {
            button.disabled = false
        }
    })
}

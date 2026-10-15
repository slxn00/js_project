import '../css/style.css'
import { supabase } from './supabaseClient.js'
import { showAuthStatus, bindSocialAuth } from './auth-ui.js'
import { getAuthCallbackError } from './auth-callback.js'

// DOM 요소
const signupForm = document.querySelector('#signup-form')
const nameInput = document.querySelector('#name')
const emailInput = document.querySelector('#email')
const otpGroup = document.querySelector('#otp-group')
const otpInput = document.querySelector('#otp')
const sendOtpBtn = document.querySelector('#send-otp-btn')
const verifyOtpBtn = document.querySelector('#verify-otp-btn')
const otpStatusText = document.querySelector('#otp-status-text')

const passwordGroup = document.querySelector('#password-group')
const passwordConfirmGroup = document.querySelector('#password-confirm-group')
const passwordInput = document.querySelector('#password')
const passwordConfirmInput = document.querySelector('#password-confirm')

const socialBadge = document.querySelector('#social-badge')
const providerName = document.querySelector('#provider-name')
const socialSection = document.querySelector('#social-section')

const googleBtn = document.querySelector('#google-signup-btn')
const kakaoBtn = document.querySelector('#kakao-signup-btn')
const eyeBtns = document.querySelectorAll('.eye-btn')
const signupBtn = document.querySelector('#signup-btn')

let isSocialMode = false
let isEmailVerified = false
let verifiedEmail = ''
let otpEmail = ''
let otpBusy = false

// 이메일 정규식 검증 함수
function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// 1. 이메일 입력 시 실시간 감지 -> 버튼 활성화 / 비활성화
emailInput.addEventListener('input', () => {
    const emailVal = emailInput.value.trim()
    emailInput.classList.remove('error')
    if (emailVal !== verifiedEmail) {
        isEmailVerified = false
        verifiedEmail = ''
    }
    if (emailVal !== otpEmail) {
        otpGroup.classList.add('hidden')
        otpInput.value = ''
        otpStatusText.textContent = ''
    }

    // 올바른 이메일 형식이 작성되었고 이미 인증 완료된 상태가 아니면 버튼 활성화
    if (validateEmail(emailVal) && !isEmailVerified && !otpBusy) {
        sendOtpBtn.disabled = false
    } else {
        sendOtpBtn.disabled = true
    }
})

// 입력창 클릭/타이핑 시 빨간 에러 테두리 제거
;[nameInput, otpInput, passwordInput, passwordConfirmInput].forEach(input => {
    if (input) {
        input.addEventListener('input', () => input.classList.remove('error'))
    }
})

// 2. 소셜 로그인 연동 여부 점검
async function checkSocialSession() {
    const { data: { session }, error } = await supabase.auth.getSession()
    if (error) throw error

    if (session?.user) {
        const provider = session.user.app_metadata?.provider

        if (provider === 'google' || provider === 'kakao') {
            isSocialMode = true
            socialBadge.classList.remove('hidden')
            providerName.textContent = provider === 'google' ? 'Google' : '카카오'

            if (session.user.user_metadata?.full_name || session.user.user_metadata?.name) {
                nameInput.value = session.user.user_metadata.full_name || session.user.user_metadata.name
            }
            if (session.user.email) {
                emailInput.value = session.user.email
            }
            emailInput.disabled = true
            sendOtpBtn.classList.add('hidden')

            passwordGroup.classList.add('hidden')
            passwordConfirmGroup.classList.add('hidden')
            socialSection.classList.add('hidden')
        } else if (session.user.email && session.user.email_confirmed_at) {
            // OTP 인증 후 새로고침한 경우에도 같은 계정의 비밀번호를 설정한다.
            emailInput.value = session.user.email
            verifiedEmail = session.user.email
            isEmailVerified = true
            emailInput.disabled = true
            sendOtpBtn.classList.add('hidden')
            showAuthStatus('이메일 인증이 완료되었습니다. 이름과 비밀번호를 입력해 주세요.', true)
        }
    }
}
signupBtn.disabled = true
const callbackError = getAuthCallbackError()
const sessionReady = (callbackError ? Promise.resolve(showAuthStatus(callbackError)) : checkSocialSession()).catch(showAuthStatus).finally(() => {
    signupBtn.disabled = false
})

// 3. 이메일 인증번호 발송 (Supabase OTP)
sendOtpBtn.addEventListener('click', async () => {
    await sessionReady
    if (otpBusy || isEmailVerified || isSocialMode) return
    const email = emailInput.value.trim()

    if (!validateEmail(email)) {
        emailInput.classList.add('error')
        showAuthStatus('올바른 이메일 형식을 입력해 주세요.')
        return
    }

    sendOtpBtn.disabled = true
    sendOtpBtn.textContent = '발송 중...'
    otpBusy = true
    emailInput.disabled = true
    verifyOtpBtn.disabled = true
    showAuthStatus('')

    try {
        const { error } = await supabase.auth.signInWithOtp({
            email,
            options: { emailRedirectTo: window.location.origin + '/signup.html' },
        })
        if (error) throw error
        otpEmail = email
        otpInput.value = ''
        otpStatusText.textContent = ''
        showAuthStatus('인증 메일을 발송했습니다. 메일의 인증번호를 입력하거나 인증 링크를 열어 주세요.', true)
        otpGroup.classList.remove('hidden')
    } catch (error) {
        showAuthStatus(error)
    } finally {
        otpBusy = false
        emailInput.disabled = false
        verifyOtpBtn.disabled = false
        sendOtpBtn.disabled = false
        sendOtpBtn.textContent = otpEmail === email ? '재발송' : '인증발송'
    }
})

// 4. 인증번호 검증
verifyOtpBtn.addEventListener('click', async () => {
    if (otpBusy || isEmailVerified) return
    const email = emailInput.value.trim()
    const token = otpInput.value.trim()

    if (!token || email !== otpEmail) {
        otpInput.classList.add('error')
        showAuthStatus('인증번호를 발송한 이메일과 메일의 인증번호를 확인해 주세요.')
        return
    }

    otpBusy = true
    verifyOtpBtn.disabled = true
    sendOtpBtn.disabled = true
    emailInput.disabled = true
    try {
        const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
        if (error) throw error
        if (!data.session || data.user?.email?.toLowerCase() !== email.toLowerCase()) {
            throw new Error('이메일 인증 세션을 확인하지 못했습니다. 다시 인증해 주세요.')
        }
        isEmailVerified = true
        verifiedEmail = email
        showAuthStatus('')
        otpStatusText.textContent = '✓ 이메일 인증이 완료되었습니다.'
        otpStatusText.className = 'status-text success'
        emailInput.disabled = true
        otpInput.disabled = true
        sendOtpBtn.classList.add('hidden')
        verifyOtpBtn.classList.add('hidden')
    } catch (error) {
        showAuthStatus(error)
        otpInput.classList.add('error')
    } finally {
        otpBusy = false
        emailInput.disabled = isEmailVerified
        sendOtpBtn.disabled = isEmailVerified
        verifyOtpBtn.disabled = isEmailVerified
    }
})

// 5. 비밀번호 보기/숨기기 토글
eyeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target')
        const targetInput = document.getElementById(targetId)
        targetInput.type = targetInput.type === 'password' ? 'text' : 'password'
    })
})

// 6. 회원가입 제출 처리
if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault()
        if (signupBtn.disabled || otpBusy) return
        showAuthStatus('')
        ;[nameInput, emailInput, passwordInput, passwordConfirmInput].forEach(input => input.classList.remove('error'))

        const name = nameInput.value.trim()
        const email = emailInput.value.trim()
        const password = passwordInput.value
        const passwordConfirm = passwordConfirmInput.value

        let hasError = false

        if (!name) {
            nameInput.classList.add('error')
            hasError = true
        }

        if (!isSocialMode && (!password || password.length < 6)) {
            passwordInput.classList.add('error')
            hasError = true
        }
        if (!isSocialMode && password !== passwordConfirm) {
            passwordConfirmInput.classList.add('error')
            hasError = true
        }

        if (!isSocialMode && (!validateEmail(email) || !isEmailVerified || email !== verifiedEmail)) {
            showAuthStatus('로그인에 사용할 이메일을 입력하고 인증을 완료해 주세요.')
            emailInput.classList.add('error')
            return
        }

        if (hasError) {
            showAuthStatus('이름과 6자리 이상의 비밀번호, 비밀번호 재확인을 확인해 주세요.')
            return
        }

        signupBtn.disabled = true
        signupBtn.textContent = '가입 처리 중...'
        try {
            const { data, error: userError } = await supabase.auth.getUser()
            if (userError) throw userError
            if (!data.user || (!isSocialMode && data.user.email?.toLowerCase() !== email.toLowerCase())) {
                throw new Error('인증한 계정의 세션이 없습니다. 다시 인증해 주세요.')
            }
            // OTP에서 이미 생성·인증된 계정에 비밀번호와 이름을 저장한다.
            const attributes = { data: { full_name: name } }
            if (!isSocialMode) attributes.password = password
            const { error } = await supabase.auth.updateUser(attributes)
            if (error) throw error
            window.location.href = '/main.html'
        } catch (error) {
            showAuthStatus(error)
        } finally {
            signupBtn.disabled = false
            signupBtn.textContent = '가입하기'
        }
    })
}

// 7. 소셜 회원가입 처리
bindSocialAuth(googleBtn, 'google', '/signup.html')
bindSocialAuth(kakaoBtn, 'kakao', '/signup.html')

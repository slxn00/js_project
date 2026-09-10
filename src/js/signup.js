import '../css/style.css'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

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

let isSocialMode = false
let isEmailVerified = false

// 이메일 정규식 검증 함수
function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// 1. 이메일 입력 시 실시간 감지 -> 버튼 활성화 / 비활성화
emailInput.addEventListener('input', () => {
    const emailVal = emailInput.value.trim()
    emailInput.classList.remove('error')

    // 올바른 이메일 형식이 작성되었고 이미 인증 완료된 상태가 아니면 버튼 활성화
    if (validateEmail(emailVal) && !isEmailVerified) {
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
    const { data: { session } } = await supabase.auth.getSession()

    if (session?.user) {
        const provider = session.user.app_metadata.provider

        if (provider === 'google' || provider === 'kakao') {
            isSocialMode = true
            socialBadge.classList.remove('hidden')
            providerName.textContent = provider === 'google' ? 'Google' : '카카오'

            if (session.user.user_metadata?.full_name || session.user.user_metadata?.name) {
                nameInput.value = session.user.user_metadata.full_name || session.user.user_metadata.name
            }
            if (session.user.email) {
                emailInput.value = session.user.email
                emailInput.disabled = true
                sendOtpBtn.classList.add('hidden')
                isEmailVerified = true
            }

            passwordGroup.classList.add('hidden')
            passwordConfirmGroup.classList.add('hidden')
            socialSection.classList.add('hidden')
        }
    }
}
checkSocialSession()

// 3. 이메일 인증번호 발송 (Supabase OTP)
sendOtpBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim()

    if (!validateEmail(email)) {
        emailInput.classList.add('error')
        alert('올바른 이메일 형식을 입력해 주세요.')
        return
    }

    sendOtpBtn.disabled = true
    sendOtpBtn.textContent = '발송 중...'

    const { error } = await supabase.auth.signInWithOtp({ email })

    if (error) {
        alert('인증번호 발송 실패: ' + error.message)
        sendOtpBtn.disabled = false
        sendOtpBtn.textContent = '인증발송'
    } else {
        alert('입력하신 이메일로 인증번호가 발송되었습니다!')
        otpGroup.classList.remove('hidden')
        sendOtpBtn.textContent = '재발송'
        sendOtpBtn.disabled = false
    }
})

// 4. 인증번호 검증
verifyOtpBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim()
    const token = otpInput.value.trim()

    if (!token) {
        otpInput.classList.add('error')
        return
    }

    const { error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: 'email'
    })

    if (error) {
        otpStatusText.textContent = '인증번호가 일치하지 않습니다.'
        otpStatusText.className = 'status-text error'
        otpInput.classList.add('error')
    } else {
        isEmailVerified = true
        otpStatusText.textContent = '✓ 이메일 인증이 완료되었습니다.'
        otpStatusText.className = 'status-text success'
        emailInput.disabled = true
        otpInput.disabled = true
        sendOtpBtn.classList.add('hidden')
        verifyOtpBtn.classList.add('hidden')
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

        const name = nameInput.value.trim()
        const email = emailInput.value.trim()
        const password = passwordInput.value
        const passwordConfirm = passwordConfirmInput.value

        let hasError = false

        if (!name) {
            nameInput.classList.add('error')
            hasError = true
        }

        if (isSocialMode) {
            if (hasError) return
            await supabase.auth.updateUser({ data: { full_name: name } })
            alert('회원가입 완료!')
            window.location.href = '/index.html'
            return
        }

        if (!password || password.length < 6) {
            passwordInput.classList.add('error')
            hasError = true
        }
        if (password !== passwordConfirm) {
            passwordConfirmInput.classList.add('error')
            hasError = true
        }

        // 이메일을 입력했는데 인증을 안 한 경우
        if (email && !isEmailVerified) {
            alert('이메일 인증을 완료해 주세요.')
            emailInput.classList.add('error')
            return
        }

        if (hasError) return

        const signupEmail = email || `${Date.now()}@temp.com`
        const { data, error } = await supabase.auth.signUp({
            email: signupEmail,
            password,
            options: {
                data: { full_name: name }
            }
        })

        if (error) {
            alert('가입 실패: ' + error.message)
        } else {
            alert('회원가입이 완료되었습니다!')
            window.location.href = '/index.html'
        }
    })
}

// 7. 소셜 회원가입 처리
if (googleBtn) {
    googleBtn.addEventListener('click', async () => {
        await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: window.location.origin + '/signup.html' }
        })
    })
}

if (kakaoBtn) {
    kakaoBtn.addEventListener('click', async () => {
        await supabase.auth.signInWithOAuth({
            provider: 'kakao',
            options: { redirectTo: window.location.origin + '/signup.html' }
        })
    })
}
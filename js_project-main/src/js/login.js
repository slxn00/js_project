import '../css/style.css'
import { supabase } from './supabaseClient.js'
import { showAuthStatus, bindSocialAuth } from './auth-ui.js'
import { getAuthCallbackError } from './auth-callback.js'

const callbackError = getAuthCallbackError()
if (callbackError) showAuthStatus(callbackError)

// DOM 요소
const loginForm = document.querySelector('#login-form')
const emailInput = document.querySelector('#email')
const passwordInput = document.querySelector('#password')
const googleBtn = document.querySelector('#google-login-btn')
const kakaoBtn = document.querySelector('#kakao-login-btn')
const eyeBtns = document.querySelectorAll('.eye-btn')
const loginBtn = document.querySelector('#login-btn')

    // 사용자가 다시 입력하기 시작하면 빨간색 에러 테두리 제거
    ;[emailInput, passwordInput].forEach(input => {
        if (input) {
            input.addEventListener('input', () => {
                input.classList.remove('error')
            })
        }
    })

// 1. 비밀번호 보이기/숨기기 토글
eyeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target')
        const targetInput = document.getElementById(targetId)
        targetInput.type = targetInput.type === 'password' ? 'text' : 'password'
    })
})

// 2. 이메일/비밀번호 로그인 처리
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault()
        if (loginBtn.disabled) return
        showAuthStatus('')

        // 기존 에러 표시 초기화
        emailInput.classList.remove('error')
        passwordInput.classList.remove('error')

        const email = emailInput.value.trim()
        const password = passwordInput.value

        let hasError = false

        // 입력하지 않은 칸이 있을 경우 해당 칸 빨간색 변경
        if (!email) {
            emailInput.classList.add('error')
            hasError = true
        }
        if (!password) {
            passwordInput.classList.add('error')
            hasError = true
        }

        if (hasError) {
            showAuthStatus('이메일과 비밀번호를 입력해 주세요.')
            return
        }

        // Supabase 로그인 요청
        loginBtn.disabled = true
        loginBtn.textContent = '로그인 중...'
        try {
            const { error } = await supabase.auth.signInWithPassword({ email, password })
            if (error) throw error
            window.location.href = '/main.html'
        } catch (error) {
            emailInput.classList.add('error')
            passwordInput.classList.add('error')
            showAuthStatus(error)
        } finally {
            loginBtn.disabled = false
            loginBtn.textContent = '로그인'
        }
    })
}

bindSocialAuth(googleBtn, 'google', '/main.html')
bindSocialAuth(kakaoBtn, 'kakao', '/main.html')

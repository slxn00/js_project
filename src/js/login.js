import '../css/style.css'
import { createClient } from '@supabase/supabase-js'

// Supabase 클라이언트 설정
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

// DOM 요소
const loginForm = document.querySelector('#login-form')
const emailInput = document.querySelector('#email')
const passwordInput = document.querySelector('#password')
const googleBtn = document.querySelector('#google-login-btn')
const kakaoBtn = document.querySelector('#kakao-login-btn')
const eyeBtns = document.querySelectorAll('.eye-btn')

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

        if (hasError) return

        // Supabase 로그인 요청
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        })

        if (error) {
            // 로그인 실패 시(정보 불일치 등) 입력창 빨간색으로 변경
            emailInput.classList.add('error')
            passwordInput.classList.add('error')
        } else {
            // 로그인 성공 시 메인 페이지 이동
            window.location.href = '/index.html'
        }
    })
}

// 3. Google 소셜 로그인
if (googleBtn) {
    googleBtn.addEventListener('click', async () => {
        await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: window.location.origin + '/index.html' }
        })
    })
}

// 4. 카카오 소셜 로그인
if (kakaoBtn) {
    kakaoBtn.addEventListener('click', async () => {
        await supabase.auth.signInWithOAuth({
            provider: 'kakao',
            options: { redirectTo: window.location.origin + '/index.html' }
        })
    })
}
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { getAuthCallbackError, redirectAuthCallbackError } from '../src/js/auth-callback.js'

const root = new URL('../', import.meta.url)
const email = 'teacher@example.com'
const user = { id: 'teacher-id', email, email_confirmed_at: '2026-10-15', app_metadata: { provider: 'email' } }

function element(tag) {
    const classes = new Set((tag.match(/class="([^"]*)"/)?.[1] || '').split(/\s+/).filter(Boolean))
    const listeners = new Map()
    return {
        value: '', textContent: '', disabled: /\bdisabled\b/.test(tag), hidden: /\bhidden\b/.test(tag),
        get className() { return [...classes].join(' ') },
        set className(value) { classes.clear(); value.split(/\s+/).forEach(item => classes.add(item)) },
        classList: {
            add: (...items) => items.forEach(item => classes.add(item)),
            remove: (...items) => items.forEach(item => classes.delete(item)),
            contains: item => classes.has(item),
        },
        addEventListener(event, callback) {
            listeners.set(event, [...(listeners.get(event) || []), callback])
        },
        async dispatch(event) {
            for (const callback of listeners.get(event) || []) await callback({ preventDefault() {} })
        },
    }
}

// Execute the real page modules with Supabase replaced at the SDK boundary.
// No test sends mail, creates accounts, or changes a real user's password.
async function page(name, overrides = {}, query = '') {
    const html = await readFile(new URL(`${name}.html`, root), 'utf8')
    const elements = new Map([...html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)].map(([tag, id]) => [id, element(tag)]))
    const calls = []
    const clients = []
    const defaults = {
        getSession: async () => ({ data: { session: null }, error: null }),
        getUser: async () => ({ data: { user }, error: null }),
        signInWithPassword: async () => ({ error: null }),
        signInWithOtp: async () => ({ error: null }),
        verifyOtp: async () => ({ data: { user, session: { user } }, error: null }),
        updateUser: async () => ({ data: { user }, error: null }),
        signInWithOAuth: async () => ({ error: null }),
        signUp: async () => { throw new Error('OTP 인증 후 중복 가입 요청') },
    }
    const auth = Object.fromEntries(Object.entries({ ...defaults, ...overrides }).map(([method, implementation]) => [
        method, async (...args) => { calls.push({ method, args }); return implementation(...args) },
    ]))
    const location = { origin: 'http://localhost:5173', href: `/${name}.html${query}` }
    const context = vm.createContext({
        window: { location },
        URL, URLSearchParams,
        document: {
            querySelector: selector => elements.get(selector.slice(1)),
            querySelectorAll: () => [],
            getElementById: id => elements.get(id),
        },
    })
    const modules = new Map()
    function load(url) {
        if (modules.has(url)) return modules.get(url)
        let module
        if (url === '@supabase/supabase-js') {
            module = new vm.SyntheticModule(['createClient'], function () {
                this.setExport('createClient', (url, key) => { clients.push({ url, key }); return { auth } })
            }, { context, identifier: url })
        } else if (url.endsWith('.css')) {
            module = new vm.SyntheticModule([], () => {}, { context, identifier: url })
        } else {
            module = new vm.SourceTextModule(sources.get(url), {
                context, identifier: url,
                initializeImportMeta(meta) {
                    meta.env = { VITE_SUPABASE_URL: 'https://test.supabase.co', VITE_SUPABASE_ANON_KEY: 'test-anon-key' }
                },
            })
        }
        modules.set(url, module)
        return module
    }
    const paths = ['login', 'signup', 'auth-ui', 'auth-callback', 'supabaseClient']
    const sources = new Map(await Promise.all(paths.map(async path => {
        const url = new URL(`src/js/${path}.js`, root)
        return [url.href, await readFile(url, 'utf8')]
    })))
    const entry = load(new URL(`src/js/${name}.js`, root).href)
    await entry.link((specifier, referencing) => load(specifier.startsWith('.') ? new URL(specifier, referencing.identifier).href : specifier))
    await entry.evaluate()
    await new Promise(setImmediate)
    return {
        get: id => elements.get(id), calls, clients, location,
        async fill(id, value) { elements.get(id).value = value; await elements.get(id).dispatch('input') },
        click: id => elements.get(id).dispatch('click'),
        submit: () => elements.get(`${name}-form`).dispatch('submit'),
    }
}

async function fillSignup(p) {
    await p.fill('name', '홍길동')
    await p.fill('email', email)
    await p.fill('password', 'example-password')
    await p.fill('password-confirm', 'example-password')
}

async function verify(p) {
    await p.click('send-otp-btn')
    await p.fill('otp', '12345678')
    await p.click('verify-otp-btn')
}

test('로그인은 공통 anon 키로 클라이언트 하나를 생성하고 성공 시 메인으로 이동한다', async () => {
    const p = await page('login')
    assert.deepEqual(p.clients, [{ url: 'https://test.supabase.co', key: 'test-anon-key' }])
    await p.fill('email', ` ${email} `)
    await p.fill('password', 'example-password')
    await p.submit()
    assert.equal(p.calls[0].method, 'signInWithPassword')
    assert.equal(p.calls[0].args[0].email, email)
    assert.equal(p.location.href, '/main.html')
})

test('잘못된 로그인은 원인을 표시하고 다시 시도할 수 있다', async () => {
    let fail = true
    const p = await page('login', { signInWithPassword: async () => ({ error: fail ? { code: 'invalid_credentials' } : null }) })
    await p.fill('email', email)
    await p.fill('password', 'example-password')
    await p.submit()
    assert.match(p.get('auth-status').textContent, /이메일 또는 비밀번호/)
    assert.equal(p.get('login-btn').disabled, false)
    assert.equal(p.location.href, '/login.html')
    fail = false
    await p.submit()
    assert.equal(p.location.href, '/main.html')
})

test('네트워크 예외가 발생해도 로그인 버튼을 복구한다', async () => {
    const p = await page('login', { signInWithPassword: async () => { throw new Error('Failed to fetch') } })
    await p.fill('email', email)
    await p.fill('password', 'example-password')
    await p.submit()
    assert.match(p.get('auth-status').textContent, /네트워크/)
    assert.equal(p.get('login-btn').disabled, false)
})

test('빈 로그인 입력으로 서버에 요청하지 않는다', async () => {
    const p = await page('login')
    await p.submit()
    assert.equal(p.calls.length, 0)
    assert.equal(p.get('email').classList.contains('error'), true)
})

test('OTP 인증 계정에 이름과 비밀번호를 저장하고 메인으로 이동한다', async () => {
    const p = await page('signup')
    await fillSignup(p)
    await verify(p)
    await p.submit()
    assert.equal(p.calls.some(call => call.method === 'signUp'), false)
    const update = p.calls.find(call => call.method === 'updateUser').args[0]
    assert.equal(update.password, 'example-password')
    assert.equal(update.data.full_name, '홍길동')
    assert.equal(p.get('email').disabled, true)
    assert.equal(p.location.href, '/main.html')
})

test('이메일 없이 임시 주소를 만들어 가입하지 않는다', async () => {
    const p = await page('signup')
    await p.fill('name', '홍길동')
    await p.fill('password', 'example-password')
    await p.fill('password-confirm', 'example-password')
    await p.submit()
    assert.equal(p.calls.some(call => ['signUp', 'updateUser'].includes(call.method)), false)
    assert.match(p.get('auth-status').textContent, /이메일/)
})

test('인증번호 발송 후 이메일을 바꾸면 이전 인증번호를 사용할 수 없다', async () => {
    const p = await page('signup')
    await fillSignup(p)
    await p.click('send-otp-btn')
    await p.fill('email', 'another@example.com')
    await p.fill('otp', '123456')
    await p.click('verify-otp-btn')
    assert.equal(p.get('otp-group').classList.contains('hidden'), true)
    assert.equal(p.calls.some(call => call.method === 'verifyOtp'), false)
})

test('메일 발송 오류 후 버튼을 복구하고 재발송할 수 있다', async () => {
    let fail = true
    const p = await page('signup', { signInWithOtp: async () => {
        if (fail) throw new Error('Failed to fetch')
        return { error: null }
    } })
    await fillSignup(p)
    await p.click('send-otp-btn')
    assert.equal(p.get('send-otp-btn').disabled, false)
    assert.equal(p.get('email').disabled, false)
    fail = false
    await p.click('send-otp-btn')
    assert.equal(p.get('otp-group').classList.contains('hidden'), false)
})

test('OTP 만료 시 인증 완료로 처리하지 않고 다시 시도할 수 있다', async () => {
    const p = await page('signup', { verifyOtp: async () => ({ error: { code: 'otp_expired' } }) })
    await fillSignup(p)
    await verify(p)
    await p.submit()
    assert.equal(p.calls.some(call => call.method === 'updateUser'), false)
    assert.equal(p.get('verify-otp-btn').disabled, false)
    assert.equal(p.get('email').disabled, false)
})

test('비밀번호 저장 실패 시 완료 화면으로 이동하지 않고 재시도한다', async () => {
    let fail = true
    const p = await page('signup', { updateUser: async () => ({ error: fail ? { message: 'Password is too weak' } : null }) })
    await fillSignup(p)
    await verify(p)
    await p.submit()
    assert.equal(p.location.href, '/signup.html')
    assert.equal(p.get('signup-btn').disabled, false)
    assert.match(p.get('auth-status').textContent, /Password is too weak/)
    fail = false
    await p.submit()
    assert.equal(p.location.href, '/main.html')
})

test('인증 후 다른 계정 세션으로 바뀌면 비밀번호를 저장하지 않는다', async () => {
    const p = await page('signup', { getUser: async () => ({ data: { user: { ...user, email: 'another@example.com' } }, error: null }) })
    await fillSignup(p)
    await verify(p)
    await p.submit()
    assert.equal(p.calls.some(call => call.method === 'updateUser'), false)
    assert.equal(p.location.href, '/signup.html')
})

test('인증 후 새로고침해도 확인된 계정의 가입을 완료할 수 있다', async () => {
    const p = await page('signup', { getSession: async () => ({ data: { session: { user } }, error: null }) })
    await p.fill('name', '홍길동')
    await p.fill('password', 'example-password')
    await p.fill('password-confirm', 'example-password')
    await p.submit()
    assert.equal(p.location.href, '/main.html')
    assert.equal(p.calls.some(call => call.method === 'signInWithOtp'), false)
})

test('소셜 가입 프로필 저장 오류를 표시하며 비밀번호를 설정하지 않는다', async () => {
    const socialUser = { ...user, app_metadata: { provider: 'google' } }
    const p = await page('signup', {
        getSession: async () => ({ data: { session: { user: socialUser } }, error: null }),
        updateUser: async () => ({ error: { message: 'Profile update failed' } }),
    })
    await p.fill('name', '홍길동')
    await p.submit()
    const attributes = p.calls.find(call => call.method === 'updateUser').args[0]
    assert.equal('password' in attributes, false)
    assert.equal(p.location.href, '/signup.html')
    assert.match(p.get('auth-status').textContent, /Profile update failed/)
})

test('활성화되지 않은 소셜 제공자의 오류를 표시한다', async () => {
    const p = await page('login', { signInWithOAuth: async () => ({ error: { code: 'provider_disabled' } }) })
    await p.click('kakao-login-btn')
    assert.match(p.get('auth-status').textContent, /활성화/)
    assert.equal(p.get('kakao-login-btn').disabled, false)
})

test('카카오 콜백의 이메일 권한 오류를 로그인 화면에 표시한다', async () => {
    const p = await page('login', {}, '?error=invalid_scope&error_description=Invalid+scope%3A+account_email')
    assert.match(p.get('auth-status').textContent, /이메일 동의항목\(account_email\)/)
    assert.equal(p.get('auth-status').hidden, false)
})

test('카카오 콜백 오류를 회원가입에서 세션 확인 문구로 덮어쓰지 않는다', async () => {
    const p = await page('signup', {}, '#error=invalid_scope&error_description=Invalid+scope%3A+account_email')
    assert.match(p.get('auth-status').textContent, /account_email/)
    assert.equal(p.calls.some(call => call.method === 'getSession'), false)
})

test('OAuth 오류를 메인 화면 대신 로그인 화면으로 전달한다', () => {
    const location = { href: 'http://localhost:5173/main.html?error=invalid_scope&error_description=Invalid+scope%3A+account_email', origin: 'http://localhost:5173', replace(value) { this.destination = value } }
    assert.equal(redirectAuthCallbackError(location), true)
    const destination = new URL(location.destination, location.origin)
    assert.equal(destination.pathname, '/login.html')
    assert.equal(destination.searchParams.get('error'), 'invalid_scope')
    assert.equal(destination.searchParams.get('error_description'), 'Invalid scope: account_email')
})

test('성공 콜백은 오류로 분류하거나 로그인 화면으로 보내지 않는다', () => {
    const location = { href: 'http://localhost:5173/main.html#access_token=test&token_type=bearer', origin: 'http://localhost:5173', replace() { assert.fail('성공한 콜백을 이동시키면 안 됩니다.') } }
    assert.equal(getAuthCallbackError(location), null)
    assert.equal(redirectAuthCallbackError(location), false)
})

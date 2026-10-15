# 로그인·회원가입 설정

이 디렉터리에서 `npm install`, `npm run dev`를 실행합니다.
`.env.example`을 참고해 `.env`를 작성하고, 환경변수를 바꿨다면 개발 서버를 다시 실행합니다.

- 모든 화면은 `src/js/supabaseClient.js`의 클라이언트를 공유합니다.
- `VITE_SUPABASE_URL`과 `VITE_SUPABASE_ANON_KEY`는 같은 프로젝트의 URL과 공개 anon/publishable 키여야 합니다.
- 브라우저에 포함되는 `VITE_` 변수에 secret/service_role 키를 넣지 않습니다.

Supabase의 Authentication 설정도 확인합니다.

1. **URL Configuration**: Site URL을 실제 서비스 주소로 설정하고 Redirect URLs에 개발/배포 주소의 `/main.html`, `/signup.html`을 각각 추가합니다. 예: `http://localhost:5173/signup.html`.
2. **Email Templates → Magic Link**: 인증번호 입력을 사용하려면 메일 본문에 `{{ .Token }}`을 넣습니다. 기본 인증 링크를 사용해도 `/signup.html`로 돌아온 후 이름과 비밀번호를 저장할 수 있습니다.
3. **Providers → Google / Kakao**: 사용할 제공자를 활성화하고 해당 제공자의 Client ID/Secret을 설정합니다. 제공자 콘솔에는 Supabase가 안내하는 callback URL을 등록합니다. 카카오 지도 JavaScript 키는 카카오 로그인 설정과 별개입니다.

카카오 로그인 후 `invalid_scope: account_email` 또는 KOE205가 발생하면 카카오 Developers의 **카카오 로그인 → 동의항목**에서 이메일(`account_email`), 닉네임(`profile_nickname`), 프로필 사진(`profile_image`) 설정과 해당 앱의 요청 권한을 확인합니다. 현재 Supabase Auth의 Kakao 제공자는 이 세 항목을 기본 요청합니다. `scopes` 옵션은 기본값에 추가되므로 프런트에서 이메일 항목을 뺀 문자열을 지정해도 기본 요청을 제거하지 못합니다. Supabase의 **Allow users without an email**은 반환된 이메일이 없는 계정을 허용하는 설정이며, 이 요청 항목을 제거하는 설정이 아닙니다. 이메일 항목이 **권한 없음**이면 카카오 앱의 해당 권한을 확보해야 합니다.

참고: [Supabase Kakao 제공자 코드](https://github.com/supabase/auth/blob/master/internal/api/provider/kakao.go), [카카오 동의항목 안내](https://developers.kakao.com/docs/ko/kakaologin/utilize).

회원가입은 이메일 OTP 인증으로 생성된 계정에 `updateUser`로 이름과 비밀번호를 저장합니다. 인증 후 같은 이메일로 `signUp`을 다시 요청하지 않습니다. 완료 후 `/main.html`로 이동합니다.

빌드는 `npm run build`, 빌드 결과 확인은 `npm run preview`로 실행합니다. 로그인·회원가입을 포함한 모든 HTML 화면이 `dist`에 생성됩니다.

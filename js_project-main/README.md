# 관리자·학생 화면 분리 v2 — 설치 안내

현재 업로드한 `main.html` / `main.js`를 기준으로 화면을 분리했고, 후속 요청을 반영한 파일 모음입니다.

## 반영된 요청

1. 관리자 화면: 왼쪽 영역에서 **학급 공지 카드 제거**, **학사일정 달력**만 표시. 이전/다음 달 이동, 날짜 선택 가능. 일정 등록·Supabase 동기화는 아직 미구현.
2. 학생 화면: 상단 파란색 영역의 프로필 / 이름·이메일 / 로그아웃을 가로 한 줄로 배치하고 기존 파란색 메뉴바 유지.
3. 학급코드 입력: 화면 뒤쪽 블러 모달, **5칸 코드 입력**, 영문 소문자는 대문자로 자동 변환, 숫자는 허용, 한글은 제거. 붙여넣기·Backspace·좌우 화살표 지원.
4. 학급 시작 화면: `이미 받은 학급코드가 있어요!`, `아뇨, 저는 학급을 생성해야 해요!` 문구로 변경.

## 적용 파일

- `main.html` → 프로젝트 루트에서 기존 파일 교체
- `src/js/main.js` → 기존 파일 교체
- `admin.html`, `student.html` → 프로젝트 루트에 새 파일
- `src/js/admin.js`, `src/js/admin-calendar.js`, `src/js/student.js` → 새 파일
- `src/css/admin.css`, `src/css/student.css` → 새 파일

### 기존 파일 반드시 그대로 유지

`src/css/main.css`(관리자 화면의 기존 스타일), `src/js/supabaseClient.js`, `src/js/classroom-store.js`, `src/js/classroom-dialog.js`, `src/js/auth-callback.js`, `src/js/join-class.js` 등 기존 로그인·학급 관리 파일, `create-class.html` 및 관련 파일.

**중요**: 관리자 페이지는 `src/css/main.css`를 재사용해 기존 패널을 유지합니다. 새 달력은 UI용으로만 제공되며 허위 학사일정 항목을 만들지 않습니다. 관리자 권한은 프런트엔드 분리와 별도로 Supabase RLS/DB RPC에서 검증해야 합니다.

## 테스트

1. 기존 Git 변경사항 커밋 또는 프로젝트 전체 복사 백업
2. `npm run dev`
3. `http://localhost:5173/main.html`에서 사용자 상태에 따른 이동 확인
4. `admin.html`에서 월 이동·날짜 선택, 공지 카드 삭제 여부 확인
5. `student.html`에서 파란색 상단바 확인 및 `학급 입장` → 5칸 코드 입력 테스트
6. 위치 인증은 기존 Supabase RPC `verify_checkin_location` 설정에 따라 정상 동작 여부가 달라집니다.

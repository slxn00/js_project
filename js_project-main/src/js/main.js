import { supabase } from './supabaseClient.js';
import { createClassroomStore, readSavedClasses } from './classroom-store.js';
import { redirectAuthCallbackError } from './auth.js';

const message = document.querySelector('#routeMessage');
const choices = document.querySelector('#routeChoices');
const classrooms = createClassroomStore(supabase);

async function choosePage() {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      window.location.replace('/login.html');
      return;
    }

    // 기존 프로젝트의 localStorage 학급을 Supabase로 옮기는 동작도 유지.
    const [owned, joined] = await Promise.all([
      classrooms.getOwnedClasses(readSavedClasses(data.user.id)),
      classrooms.getJoinedClasses(),
    ]);
    if (owned.length) {
      window.location.replace('/admin.html');
    } else if (joined.length) {
      window.location.replace('/student.html');
    } else {
      message.textContent = '아직 소속된 학급이 없어요. 시작할 방법을 선택해 주세요.';
      choices.hidden = false;
    }
  } catch (error) {
    message.textContent = `학급 정보를 확인할 수 없어요: ${error.message}`;
    choices.hidden = true;
  }
}

if (!redirectAuthCallbackError()) {
  if (message) {
    void choosePage();
  } else {
    // index.html에서도 같은 진입 로직을 사용하며 OAuth 콜백을 먼저 처리합니다.
    try {
      const { data, error } = await supabase.auth.getSession();
      window.location.replace(!error && data.session ? '/main.html' : '/login.html');
    } catch {
      window.location.replace('/login.html');
    }
  }
}

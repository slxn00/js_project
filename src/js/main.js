import { supabase } from './supabaseClient.js'

async function checkUserProfile() {
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    // 로그인 안 되어 있으면 로그인 페이지로
    window.location.href = '/login.html'
    return
  }

  // 1. DB에서 내 프로필 정보 조회
  let { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  // 2. 만약 DB에 프로필이 없거나 본명이 설정되어 있지 않다면
  if (!profile || !profile.name) {
    const realName = prompt("선생님이 출석부에서 확인하실 '본명'을 입력해 주세요 (예: 홍길동):")

    if (realName && realName.trim() !== '') {
      // 입력받은 진짜 이름을 DB에 저장
      const role = localStorage.getItem('signup_role') || 'student'

      await supabase.from('profiles').upsert({
        id: user.id,
        name: realName.trim(),
        role: role
      })

      alert(`${realName}님, 프로필 설정이 완료되었습니다!`)
      location.reload()
    } else {
      alert("본명을 입력해야 서비스를 이용할 수 있습니다.")
      await supabase.auth.signOut()
      window.location.href = '/login.html'
    }
  } else {
    console.log(`환영합니다, ${profile.name}님!`)
  }
}

checkUserProfile()
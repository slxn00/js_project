import { assignedPrompt, CameraSession } from './checkin/camera-session.js'

const $ = selector => document.querySelector(selector)
let storage
try { storage = window.sessionStorage } catch { /* Storage is optional. */ }
const prompt = assignedPrompt(storage)
$('#promptLabel').textContent = prompt.label
$('#promptHint').textContent = prompt.hint

const video = $('#camera')
const camera = new CameraSession(video, navigator.mediaDevices)
let opening = false

function status(text, error = false) {
    $('#cameraStatus').textContent = text
    $('#cameraStatus').classList.toggle('error', error)
}

function resetView() {
    video.hidden = true
    $('#liveBadge').hidden = true
    $('#takePhoto').hidden = true
    $('#takePhoto').disabled = true
    $('#startCamera').hidden = false
    $('#startCamera').disabled = false
    $('#cameraPlaceholder').hidden = false
}

async function start() {
    if (opening) return
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        status('카메라는 HTTPS 또는 localhost 주소에서 사용할 수 있어요. 스마트폰에서는 HTTPS 주소로 접속해 주세요.', true)
        return
    }
    opening = true
    $('#startCamera').disabled = true
    $('#retakePhoto').disabled = true
    const hadPhoto = !$('#photoPreview').hidden
    status('카메라를 열고 있어요. 권한 요청이 뜨면 허용해 주세요.')
    try {
        video.hidden = false
        const ready = await camera.start()
        if (!ready) { resetView(); return }
        $('#photoPreview').hidden = true
        $('#photoPreview').removeAttribute('src')
        $('#savePhoto').removeAttribute('href')
        $('#photoActions').hidden = true
        $('#cameraPlaceholder').hidden = true
        $('#startCamera').hidden = true
        $('#takePhoto').hidden = false
        $('#takePhoto').disabled = video.videoWidth === 0
        $('#liveBadge').hidden = false
        status(`‘${prompt.label}’이 선명하게 보이면 촬영해 주세요.`)
    } catch (error) {
        resetView()
        if (hadPhoto) { $('#cameraPlaceholder').hidden = true; $('#startCamera').hidden = true }
        const messages = {
            NotAllowedError: '카메라 권한이 꺼져 있어요. 브라우저의 사이트 설정에서 카메라를 허용한 뒤 다시 시도해 주세요.',
            NotFoundError: '사용할 수 있는 카메라를 찾지 못했어요.',
            NotReadableError: '다른 앱에서 카메라를 사용 중일 수 있어요. 사용 중인 앱을 닫고 다시 시도해 주세요.',
        }
        status(messages[error.name] || '카메라를 열지 못했어요. 다시 시도해 주세요.', true)
    } finally {
        opening = false
        $('#startCamera').disabled = false
        $('#retakePhoto').disabled = false
    }
}

$('#startCamera').addEventListener('click', start)
$('#retakePhoto').addEventListener('click', start)
video.addEventListener('canplay', () => { $('#takePhoto').disabled = !camera.stream || video.videoWidth === 0 })
$('#takePhoto').addEventListener('click', () => {
    if (opening) return
    try {
        const frame = $('#viewfinder')
        const photo = camera.capture(document.createElement('canvas'), { width: frame.clientWidth, height: frame.clientHeight })
        $('#photoPreview').src = photo
        $('#photoPreview').hidden = false
        video.hidden = true
        $('#liveBadge').hidden = true
        $('#takePhoto').hidden = true
        $('#cameraPlaceholder').hidden = true
        $('#photoActions').hidden = false
        $('#savePhoto').href = photo
        $('#savePhoto').download = `checkin-${prompt.id}-${Date.now()}.jpg`
        status('사진이 준비됐어요. 확인하거나 다시 촬영할 수 있어요.')
    } catch (error) { status(error.message, true) }
})

function pause() {
    const wasOpen = Boolean(camera.stream) || opening
    camera.stop()
    if (wasOpen && $('#photoPreview').hidden) {
        resetView()
        status('카메라를 일시 정지했어요. 촬영하려면 다시 켜 주세요.')
    }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) pause() })
window.addEventListener('pagehide', pause)

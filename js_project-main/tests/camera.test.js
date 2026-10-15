import test from 'node:test'
import assert from 'node:assert/strict'
import { assignedPrompt, CameraSession } from '../src/js/checkin/camera-session.js'
import { CLASSROOM_PROMPTS } from '../src/js/checkin/prompts.js'

function memoryStorage() {
    const values = new Map()
    return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }
}
const random = number => ({ getRandomValues(values) { values[0] = number; return values } })

function hardware({ width = 1920, height = 1080, play = async () => {} } = {}) {
    const track = { readyState: 'live', stopped: false, stop() { this.stopped = true; this.readyState = 'ended' } }
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] }
    const video = { srcObject: null, videoWidth: width, videoHeight: height, play }
    const requests = []
    const mediaDevices = { async getUserMedia(options) { requests.push(options); return stream } }
    return { track, stream, video, mediaDevices, requests }
}

test('제시어 8개 중 하나를 무작위로 배정한다', () => {
    const labels = new Set()
    for (let index = 0; index < CLASSROOM_PROMPTS.length; index++) labels.add(assignedPrompt(memoryStorage(), random(index)).label)
    assert.deepEqual([...labels], ['천장등', '에어컨', '전자칠판', '사물함', '책상', '블라인드', '커튼', '태극기'])
})

test('같은 세션에서 새로고침해도 배정된 제시어를 유지한다', () => {
    const storage = memoryStorage()
    const first = assignedPrompt(storage, random(2))
    const second = assignedPrompt(storage, { getRandomValues() { assert.fail('기존 배정이 있으면 다시 뽑지 않아야 합니다.') } })
    assert.equal(first.id, second.id)
})

test('저장소 사용이 차단되어도 제시어를 배정한다', () => {
    const storage = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
    assert.equal(assignedPrompt(storage, random(7)).label, '태극기')
})

test('목록에서 사라진 제시어가 저장되어 있으면 유효한 제시어를 새로 배정한다', () => {
    const storage = memoryStorage()
    storage.setItem('classroom-camera-prompt:v1', 'removed-prompt')
    assert.equal(assignedPrompt(storage, random(3)).label, '사물함')
})

test('후면 카메라를 우선 요청하고 마이크는 요청하지 않는다', async () => {
    const h = hardware()
    const camera = new CameraSession(h.video, h.mediaDevices)
    assert.equal(await camera.start(), true)
    assert.equal(h.requests[0].video.facingMode.ideal, 'environment')
    assert.equal(h.requests[0].audio, false)
    assert.equal(h.video.srcObject, h.stream)
    camera.stop()
    assert.equal(h.track.stopped, true)
    assert.equal(h.video.srcObject, null)
})

test('권한 요청 중 화면을 벗어나면 뒤늦게 허용된 카메라도 즉시 종료한다', async () => {
    const h = hardware()
    let allow
    const camera = new CameraSession(h.video, { getUserMedia: () => new Promise(resolve => { allow = resolve }) })
    const opening = camera.start()
    camera.stop()
    allow(h.stream)
    assert.equal(await opening, false)
    assert.equal(h.track.stopped, true)
    assert.equal(h.video.srcObject, null)
})

test('촬영은 원본 비율로 JPEG를 만들고 카메라를 종료한다', async () => {
    const h = hardware()
    const camera = new CameraSession(h.video, h.mediaDevices)
    await camera.start()
    const draw = []
    const canvas = {
        width: 0, height: 0,
        getContext: () => ({ drawImage: (...args) => draw.push(args) }),
        toDataURL(type, quality) { assert.equal(type, 'image/jpeg'); assert.equal(quality, .85); return 'data:image/jpeg;base64,test' },
    }
    assert.equal(camera.capture(canvas), 'data:image/jpeg;base64,test')
    assert.equal(canvas.width, 1280)
    assert.equal(canvas.height, 720)
    assert.deepEqual(draw[0], [h.video, 0, 0, 1280, 720])
    assert.equal(h.track.stopped, true)
})

test('영상 준비 전에는 검은 사진을 촬영하지 않는다', async () => {
    const h = hardware({ width: 0, height: 0 })
    const camera = new CameraSession(h.video, h.mediaDevices)
    await camera.start()
    assert.throws(() => camera.capture({}), /카메라가 준비되면/)
    camera.stop()
})

test('세로 카메라 영역에 보이는 가운데 부분을 동일한 비율로 촬영한다', async () => {
    const h = hardware()
    const camera = new CameraSession(h.video, h.mediaDevices)
    await camera.start()
    let drawn
    const canvas = { getContext: () => ({ drawImage: (...args) => { drawn = args } }), toDataURL: () => 'data:image/jpeg;base64,test' }
    camera.capture(canvas, { width: 390, height: 600 })
    assert.equal(canvas.width, 702)
    assert.equal(canvas.height, 1080)
    assert.deepEqual(drawn, [h.video, 609, 0, 702, 1080, 0, 0, 702, 1080])
    assert.equal(h.track.stopped, true)
})

test('영상 재생이 실패하면 카메라 스트림을 정리한다', async () => {
    const h = hardware({ play: async () => { throw new Error('Playback denied') } })
    const camera = new CameraSession(h.video, h.mediaDevices)
    await assert.rejects(camera.start(), /Playback denied/)
    assert.equal(h.track.stopped, true)
    assert.equal(h.video.srcObject, null)
})

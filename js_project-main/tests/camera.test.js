import test from 'node:test'
import assert from 'node:assert/strict'
import { CameraSession } from '../src/js/checkin/camera-session.js'

function hardware({ width = 1920, height = 1080, play = async () => {} } = {}) {
    const track = { readyState: 'live', stopped: false, stop() { this.stopped = true; this.readyState = 'ended' } }
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] }
    const video = { srcObject: null, videoWidth: width, videoHeight: height, play }
    const requests = []
    const mediaDevices = { async getUserMedia(options) { requests.push(options); return stream } }
    return { track, stream, video, mediaDevices, requests }
}

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

import { CLASSROOM_PROMPTS } from './prompts.js'

const PROMPT_KEY = 'classroom-camera-prompt:v1'

export function assignedPrompt(storage, cryptoSource = globalThis.crypto) {
    let stored
    try { stored = storage?.getItem(PROMPT_KEY) } catch { /* Storage may be unavailable. */ }
    const previous = CLASSROOM_PROMPTS.find(prompt => prompt.id === stored)
    if (previous) return previous
    const size = CLASSROOM_PROMPTS.length
    const limit = 2 ** 32 - (2 ** 32 % size)
    const random = new Uint32Array(1)
    do { cryptoSource.getRandomValues(random) } while (random[0] >= limit)
    const selected = CLASSROOM_PROMPTS[random[0] % size]
    try { storage?.setItem(PROMPT_KEY, selected.id) } catch { /* Still keep the prompt for this page. */ }
    return selected
}

export class CameraSession {
    constructor(video, mediaDevices) { this.video = video; this.mediaDevices = mediaDevices; this.stream = null; this.version = 0 }
    stop() {
        this.version++
        this.stream?.getTracks().forEach(track => track.stop())
        this.stream = null
        this.video.srcObject = null
    }
    async start() {
        this.stop()
        const version = this.version
        const stream = await this.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false,
        })
        if (version !== this.version) { stream.getTracks().forEach(track => track.stop()); return false }
        this.stream = stream
        this.video.srcObject = stream
        try {
            await this.video.play()
            if (version !== this.version) return false
            return true
        } catch (error) {
            if (version === this.version) this.stop()
            throw error
        }
    }
    capture(canvas, frame) {
        if (!this.stream || !this.video.videoWidth || !this.video.videoHeight || this.stream.getVideoTracks().every(track => track.readyState === 'ended')) throw new Error('카메라가 준비되면 다시 촬영해 주세요.')
        let width = this.video.videoWidth
        let height = this.video.videoHeight
        const framed = Number.isFinite(frame?.width) && Number.isFinite(frame?.height) && frame.width > 0 && frame.height > 0
        if (framed) {
            const aspect = frame.width / frame.height
            if (width / height > aspect) width = height * aspect
            else height = width / aspect
        }
        const ratio = Math.min(1, 1280 / Math.max(width, height))
        canvas.width = Math.max(1, Math.round(width * ratio))
        canvas.height = Math.max(1, Math.round(height * ratio))
        const context = canvas.getContext('2d')
        if (!context) throw new Error('사진을 만들지 못했어요. 다시 촬영해 주세요.')
        if (framed) context.drawImage(this.video, (this.video.videoWidth - width) / 2, (this.video.videoHeight - height) / 2, width, height, 0, 0, canvas.width, canvas.height)
        else context.drawImage(this.video, 0, 0, canvas.width, canvas.height)
        const dataUrl = canvas.toDataURL('image/jpeg', .85)
        this.stop()
        return dataUrl
    }
}

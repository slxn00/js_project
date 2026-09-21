const camera = document.getElementById("camera");
const photo = document.getElementById("photo");
const cameraStatus = document.getElementById("cameraStatus");
const takePhotoButton = document.getElementById("takePhoto");
const countdown = document.getElementById("countdown");
const studentNames = [
    "공은성", "김세주", "김진영", "노윤서", "민서연", "박주혁",
    "박준서", "성낙준", "성연우", "신수아", "윤지온", "이담현",
    "이연수", "정지은", "조유진", "최명준", "홍성재"
];
const knownFaces = [];
const modelUrl = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";
const matchThreshold = 0.55;
const cutoffStorageKey = "attendanceCutoffTime";
let cameraStream;
let modelsReady = false;

function getAttendanceStatus() {
    const cutoffTime = localStorage.getItem(cutoffStorageKey) || "09:00";
    const [cutoffHour, cutoffMinute] = cutoffTime.split(":").map(Number);
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setHours(cutoffHour, cutoffMinute, 0, 0);
    return now > cutoff ? "지각" : "출석";
}

function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function loadFaceModels() {
    cameraStatus.textContent = "얼굴 인식 모델을 불러오는 중입니다.";
    await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl),
        faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl),
        faceapi.nets.faceRecognitionNet.loadFromUri(modelUrl)
    ]);
    modelsReady = true;
}

async function loadKnownFaces() {
    for (const name of studentNames) {
        try {
            const image = await faceapi.fetchImage(`faces/${name}.jpg`);
            const detection = await faceapi
                .detectSingleFace(image, new faceapi.TinyFaceDetectorOptions())
                .withFaceLandmarks()
                .withFaceDescriptor();

            if (detection) {
                knownFaces.push({ name, descriptor: detection.descriptor });
            }
        } catch (error) {
            console.warn(`${name} 기준 사진을 불러오지 못했습니다.`, error);
        }
    }
}

async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        cameraStatus.textContent = "카메라는 localhost 또는 HTTPS에서만 사용할 수 있습니다.";
        return;
    }

    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user" },
            audio: false
        });
        camera.srcObject = cameraStream;
        takePhotoButton.disabled = false;
        cameraStatus.textContent = knownFaces.length > 0
            ? "카메라가 켜졌습니다. 얼굴을 촬영해주세요."
            : "학생 기준 사진을 불러오는 중입니다.";
    } catch (error) {
        cameraStatus.textContent = "카메라 권한을 허용했는지 확인해주세요.";
        console.error(error);
    }
}

takePhotoButton.addEventListener("click", async () => {
    takePhotoButton.disabled = true;
    camera.style.display = "block";
    photo.style.display = "none";
    cameraStatus.textContent = "잠시 후 촬영합니다. 화면을 보고 있어주세요.";
    countdown.hidden = false;

    for (let count = 3; count > 0; count--) {
        countdown.textContent = count;
        await wait(1000);
    }

    countdown.hidden = true;
    const context = photo.getContext("2d");
    photo.width = camera.videoWidth;
    photo.height = camera.videoHeight;
    context.drawImage(camera, 0, 0);
    camera.style.display = "none";
    photo.style.display = "block";

    cameraStatus.textContent = "얼굴을 비교하는 중입니다.";

    try {
        const detection = await faceapi
            .detectSingleFace(photo, new faceapi.TinyFaceDetectorOptions())
            .withFaceLandmarks()
            .withFaceDescriptor();

        if (!detection) {
            cameraStatus.textContent = "얼굴을 찾지 못했습니다. 다시 촬영해주세요.";
            takePhotoButton.disabled = false;
            return;
        }

        const bestMatch = knownFaces
            .map((knownFace) => ({
                name: knownFace.name,
                distance: faceapi.euclideanDistance(
                    detection.descriptor,
                    knownFace.descriptor
                )
            }))
            .sort((first, second) => first.distance - second.distance)[0];

        if (bestMatch.distance <= matchThreshold) {
            const attendanceStatus = getAttendanceStatus();
            cameraStatus.textContent = `${bestMatch.name}님으로 확인되었습니다. ${attendanceStatus} 처리합니다.`;
            cameraStream?.getTracks().forEach((track) => track.stop());
            window.location.href = `main.html?present=${encodeURIComponent(bestMatch.name)}&status=${encodeURIComponent(attendanceStatus)}`;
        } else {
            cameraStatus.textContent = "일치하는 학생이 없습니다. 다시 촬영해주세요.";
            takePhotoButton.disabled = false;
        }
    } catch (error) {
        cameraStatus.textContent = "얼굴 비교 중 오류가 발생했습니다. 다시 촬영해주세요.";
        takePhotoButton.disabled = false;
        console.error(error);
    }
});

document.getElementById("backToAttendance").addEventListener("click", () => {
    cameraStream?.getTracks().forEach((track) => track.stop());
    window.location.href = "main.html";
});

Promise.all([startCamera(), loadFaceModels()])
    .then(loadKnownFaces)
    .then(() => {
        cameraStatus.textContent = knownFaces.length > 0
            ? "카메라가 준비되었습니다. 얼굴을 촬영해주세요."
            : "faces 폴더에 학생 기준 사진을 넣어주세요.";
    })
    .catch((error) => {
        cameraStatus.textContent = "얼굴 인식 모델을 불러오지 못했습니다. 인터넷 연결을 확인해주세요.";
        console.error(error);
    });

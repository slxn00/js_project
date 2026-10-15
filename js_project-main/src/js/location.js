
const $ = (selector) => document.querySelector(selector);

const button = $("#checkLocation");
const status = $("#status");
const result = $("#result");
const resultTitle = $("#resultTitle");
const resultDetail = $("#resultDetail");
const accuracyText = $("#accuracy");

// 두 좌표 사이의 거리를 미터 단위로 계산
function distanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const rad = (degree) => degree * Math.PI / 180;

    const dLat = rad(lat2 - lat1);
    const dLon = rad(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(rad(lat1)) *
        Math.cos(rad(lat2)) *
        Math.sin(dLon / 2) ** 2;

    return 2 * R * Math.asin(
        Math.sqrt(Math.min(1, a))
    );
}

button.addEventListener("click", () => {
    const schoolName = $("#schoolName").value.trim();
    const latitude = Number($("#latitude").value);
    const longitude = Number($("#longitude").value);
    const radius = Number($("#radius").value);

    if (
        !schoolName ||
        $("#latitude").value.trim() === "" ||
        $("#longitude").value.trim() === "" ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180 ||
        !Number.isFinite(radius) ||
        radius < 1 ||
        radius > 5000
    ) {
        status.textContent =
            "학교 이름, 좌표, 인증 반경을 올바르게 입력해 주세요.";
        return;
    }

    if (!navigator.geolocation) {
        status.textContent =
            "현재 브라우저는 위치 확인 기능을 지원하지 않습니다.";
        return;
    }

    button.disabled = true;
    result.hidden = true;
    status.textContent = "현재 위치를 확인하고 있어요.";

    navigator.geolocation.getCurrentPosition(
        (position) => {
            button.disabled = false;

            const userLat = position.coords.latitude;
            const userLon = position.coords.longitude;
            const accuracy = position.coords.accuracy;

            const distance = distanceMeters(
                userLat,
                userLon,
                latitude,
                longitude
            );

            result.hidden = false;
            accuracyText.textContent =
                `기기에서 제공한 위치 정확도: 약 ${Math.round(accuracy)}m`;

            if (accuracy > 100) {
                resultTitle.textContent = "위치 확인 보류";
                resultDetail.textContent =
                    "위치 오차가 커서 판정하지 않았어요. 위치 설정을 확인하고 다시 시도해 주세요.";
                status.textContent = "위치 정확도를 확인해 주세요.";
                return;
            }

            const inside = distance <= radius;

            resultTitle.textContent = inside
                ? "인증 범위 안에 있어요!"
                : "인증 범위 밖이에요.";

            resultDetail.textContent =
                `${schoolName}에서 약 ${Math.round(distance)}m 떨어져 있어요. ` +
                `설정된 반경은 ${radius}m입니다.`;

            status.textContent = "위치 확인이 완료됐어요.";
        },
        (error) => {
            button.disabled = false;

            const messages = {
                1: "위치 권한을 허용해 주세요.",
                2: "현재 위치를 가져오지 못했어요. 기기의 위치 설정을 확인해 주세요.",
                3: "위치 확인 시간이 초과됐어요. 다시 시도해 주세요.",
            };

            status.textContent =
                messages[error.code] || "위치 확인 중 오류가 발생했어요.";
        },
        {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0,
        }
    );
});

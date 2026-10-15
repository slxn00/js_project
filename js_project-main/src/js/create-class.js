
import { supabase } from "./supabaseClient.js";

const $ = (selector) => document.querySelector(selector);

const form = $("#classForm");
const classNameInput = $("#className");
const schoolSearch = $("#schoolSearch");
const searchButton = $("#searchButton");
const searchStatus = $("#searchStatus");
const schoolResults = $("#schoolResults");
const createButton = $("#createButton");
const saveStatus = $("#saveStatus");
window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    if (event.data?.type !== 'CREATE_CLASS_ERROR') return;
    saveStatus.textContent = event.data.message;
    createButton.disabled = false;
});
const radiusInput = $("#radius");
const mapElement = $("#map");

const KAKAO_KEY = import.meta.env.VITE_KAKAO_JS_KEY;
console.log("카카오 키 설정 여부:", Boolean(KAKAO_KEY));

const isEmbedded =
    new URLSearchParams(window.location.search)
        .get("embed") === "1";

if (isEmbedded) {
    document.documentElement.classList.add("embedded-create-class");
    document.body.classList.add("embedded-create-class");
}


let placesService = null;
let selectedSchool = null;

let map = null;
let marker = null;
let circle = null;

let searchRequestId = 0;
let sdkReady = false;

function setMessage(element, message) {
    element.textContent = message;
}

// 1. 카카오 지도 SDK 불러오기
function loadKakaoSDK() {
    return new Promise((resolve, reject) => {
        if (!KAKAO_KEY) {
            reject(new Error(
                ".env에 VITE_KAKAO_JS_KEY가 없습니다."
            ));
            return;
        }

        if (window.kakao?.maps?.services) {
            resolve();
            return;
        }

        const script = document.createElement("script");

        const params = new URLSearchParams({
            appkey: KAKAO_KEY,
            libraries: "services",
            autoload: "false",
        });

        script.src =
            `https://dapi.kakao.com/v2/maps/sdk.js?${params}`;

        script.async = true;

        let settled = false;

        const timeoutId = setTimeout(() => {
            if (settled) return;
            settled = true;

            reject(new Error(
                "카카오 지도 응답이 지연되고 있습니다. 네트워크와 키 설정을 확인해 주세요."
            ));
        }, 15000);

        function finish(error) {
            if (settled) return;

            settled = true;
            clearTimeout(timeoutId);

            if (error) {
                reject(error);
            } else {
                resolve();
            }
        }

        script.onload = () => {
            if (!window.kakao?.maps?.load) {
                finish(new Error(
                    "카카오 지도 객체를 찾지 못했습니다."
                ));
                return;
            }

            window.kakao.maps.load(() => {
                if (!window.kakao?.maps?.services?.Places) {
                    finish(new Error(
                        "카카오 장소 검색 서비스를 불러오지 못했습니다."
                    ));
                    return;
                }

                finish();
            });
        };

        script.onerror = () => {
            finish(new Error(
                "카카오 지도 SDK 요청이 실패했습니다. 키와 허용 도메인 및 카카오맵 사용 권한을 확인해 주세요."
            ));
        };

        document.head.appendChild(script);
    });
}

// 2. SDK 로딩 이후 장소 검색 준비
async function initializeKakao() {
    searchButton.disabled = true;
    setMessage(searchStatus, "카카오 지도를 불러오는 중입니다.");

    try {
        await loadKakaoSDK();

        placesService = new window.kakao.maps.services.Places();
        sdkReady = true;

        searchButton.disabled = false;

        setMessage(
            searchStatus,
            "학교 이름을 입력하고 검색해 주세요."
        );

        console.log("카카오 지도 SDK 준비 완료");
    } catch (error) {
        console.error("카카오 지도 로딩 실패:", error);

        setMessage(searchStatus, error.message);
    }
}

// 3. 반경 값 업데이트
function updateRadius() {
    const radius = Number(radiusInput.value);

    $("#radiusValue").textContent = radius;
    $("#summaryRadius").textContent = radius;

    if (circle && map) {
        circle.setRadius(radius);

        // 변경된 반경의 원 전체가 보이도록 지도 조절
        map.setBounds(circle.getBounds(), 40, 40, 40, 40);
    }
}

// 4. 학교 선택 후 지도 생성 및 표시
function showSchoolOnMap(school) {
    if (!sdkReady) return;

    const kakao = window.kakao;

    const position = new kakao.maps.LatLng(
        school.latitude,
        school.longitude
    );

    if (!map) {
        // 안내 화면을 삭제해야 실제 지도를 표시할 수 있음
        mapElement.replaceChildren();

        map = new kakao.maps.Map(mapElement, {
            center: position,
            level: 4,
        });
    }

    // 이전 마커와 원 제거
    if (marker) {
        marker.setMap(null);
    }

    if (circle) {
        circle.setMap(null);
    }

    marker = new kakao.maps.Marker({
        map,
        position,
        title: school.name,
    });

    circle = new kakao.maps.Circle({
        map,
        center: position,
        radius: Number(radiusInput.value),

        strokeWeight: 2,
        strokeColor: "#347DF1",
        strokeOpacity: 0.95,
        strokeStyle: "solid",

        fillColor: "#347DF1",
        fillOpacity: 0.18,
    });

    map.relayout();
    map.setCenter(position);

    // 실제 거리 기준으로 반경 원 표시
    map.setBounds(circle.getBounds(), 40, 40, 40, 40);

    $("#summaryName").textContent = school.name;
    $("#summaryAddress").textContent = school.address;
}

// 5. 검색 결과에서 학교 선택
function selectSchool(place) {
    const latitude = Number(place.y);
    const longitude = Number(place.x);

    if (!Number.isFinite(latitude) ||
        !Number.isFinite(longitude)) {
        setMessage(searchStatus, "학교 좌표를 확인할 수 없습니다.");
        return;
    }

    selectedSchool = {
        id: place.id,
        name: place.place_name,
        address:
            place.road_address_name ||
            place.address_name ||
            "주소 정보 없음",
        latitude,
        longitude,
    };

    $("#selectedSchoolName").textContent =
        selectedSchool.name;

    $("#selectedSchoolAddress").textContent =
        selectedSchool.address;

    $("#selectedSchool").hidden = false;

    schoolResults.replaceChildren();

    setMessage(searchStatus, "학교 선택 완료!");
    setMessage(saveStatus, "");

    showSchoolOnMap(selectedSchool);

    updateCreateButton();
}

// 6. 검색 결과 목록 표시
function renderSchoolResults(places) {
    schoolResults.replaceChildren();

    if (!places.length) {
        setMessage(
            searchStatus,
            "검색 결과가 없습니다. 학교 이름을 다시 입력해 주세요."
        );
        return;
    }

    setMessage(
        searchStatus,
        `${places.length}개의 결과가 있습니다. 학교를 선택해 주세요.`
    );

    places.forEach((place) => {
        const button = document.createElement("button");

        button.type = "button";
        button.className = "school-result";

        const name = document.createElement("strong");
        name.textContent = place.place_name;

        const address = document.createElement("span");
        address.textContent =
            place.road_address_name ||
            place.address_name ||
            "주소 정보 없음";

        button.append(name, address);

        button.addEventListener("click", () => {
            selectSchool(place);
        });

        schoolResults.appendChild(button);
    });
}

// 7. 학교 검색 실행
function searchSchool() {
    const query = schoolSearch.value.trim();

    if (!query) {
        setMessage(searchStatus, "학교 이름을 입력해 주세요.");
        return;
    }

    if (!sdkReady || !placesService) {
        setMessage(
            searchStatus,
            "카카오 지도가 준비되지 않았습니다. 설정을 확인해 주세요."
        );
        return;
    }

    const currentRequestId = ++searchRequestId;

    // 이전에 선택한 학교 초기화
    selectedSchool = null;
    $("#selectedSchool").hidden = true;
    updateCreateButton();

    setMessage(searchStatus, "학교 검색 중...");
    schoolResults.replaceChildren();

    placesService.keywordSearch(
        query,
        (data, status) => {
            if (currentRequestId !== searchRequestId) {
                return;
            }

            const kakao = window.kakao;

            if (status === kakao.maps.services.Status.OK) {
                renderSchoolResults(data);
            } else if (
                status === kakao.maps.services.Status.ZERO_RESULT
            ) {
                setMessage(
                    searchStatus,
                    "검색 결과가 없습니다. 다른 학교 이름으로 검색해 주세요."
                );
            } else {
                setMessage(
                    searchStatus,
                    "장소 검색 요청에 실패했습니다. 카카오 API 설정을 확인해 주세요."
                );
            }
        }
    );
}

// 8. 버튼 상태
function updateCreateButton() {
    createButton.disabled =
        !selectedSchool ||
        !classNameInput.value.trim();
}

// 9. 학교 검색 버튼
searchButton.addEventListener("click", searchSchool);

// 엔터키로 검색
schoolSearch.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault();
        searchSchool();
    }
});

// 다른 학교 선택
$("#changeSchool").addEventListener("click", () => {
    ++searchRequestId;

    selectedSchool = null;

    $("#selectedSchool").hidden = true;
    schoolResults.replaceChildren();

    if (marker) marker.setMap(null);
    if (circle) circle.setMap(null);

    marker = null;
    circle = null;

    $("#summaryName").textContent =
        "아직 선택하지 않았어요";

    $("#summaryAddress").textContent =
        "학교를 검색한 후 선택해 주세요.";

    setMessage(searchStatus, "다른 학교를 검색해 주세요.");

    updateCreateButton();
    schoolSearch.focus();
});

// 학급명 입력
classNameInput.addEventListener(
    "input",
    updateCreateButton
);

// 반경 변경
radiusInput.addEventListener("input", updateRadius);


form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const className = classNameInput.value.trim();

    if (!className || !selectedSchool) {
        setMessage(
            saveStatus,
            "학급명과 학교를 입력해 주세요."
        );
        return;
    }

    createButton.disabled = true;

    try {
        // 로그인 확인
        const { data, error } =
            await supabase.auth.getUser();

        if (error || !data.user) {
            setMessage(
                saveStatus,
                "로그인 후 학급을 생성해 주세요."
            );
            return;
        }

        // 생성할 학급 정보
        const classData = {
            className,
            school: selectedSchool,
            radiusMeters: Number(radiusInput.value),
        };

        // 메인화면에 학급 생성 요청 전달
        if (window.parent !== window) {
            window.parent.postMessage(
                {
                    type: "CREATE_CLASS_REQUEST",
                    classData,
                },
                window.location.origin
            );

            setMessage(saveStatus, "학급을 생성하고 있습니다.");
        } else {
            setMessage(
                saveStatus,
                "메인화면에서 학급 생성창을 열어 주세요."
            );
        }

    } catch (error) {
        console.error(error);

        setMessage(
            saveStatus,
            "학급 생성 요청 중 오류가 발생했습니다."
        );
    } finally {
        createButton.disabled = false;
    }
});


// 닫기 버튼: 실제 메인 화면 연결 전 임시 동작
document.querySelector("#closeButton")
    .addEventListener("click", () => {

        if (isEmbedded) {
            window.parent.postMessage(
                { type: "CLOSE_CREATE_CLASS" },
                window.location.origin
            );
            return;
        }

        window.location.href = "/main.html";
    });

const classNameExamples = [
    "행복한 우리반",
    "지각없는 우리반",
    "활발한 우리반",
    "재밋는 우리반",
    "우리들의 교실"
];

function setRandomPlaceholder() {
    const randomIndex = Math.floor(
        Math.random() * classNameExamples.length
    );

    document.querySelector("#className").placeholder =
        `예) ${classNameExamples[randomIndex]}`;
}

// 학급 생성창이 열릴 때 자동 실행
setRandomPlaceholder();


// 초기 실행
updateRadius();
updateCreateButton();
initializeKakao();

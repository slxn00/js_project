const express = require("express");
const path = require("path");

const app = express();
const PORT = 3000;

// 여기에 본인의 Kakao REST API 키 입력
const KAKAO_REST_API_KEY = "b3aa5e606a10694416be072ab4202e87";

app.use(express.json());
app.use(express.static(__dirname));


// =============================== 
// JSON 에러 응답
function jsonError(res, status, message, detail = "") {
    return res.status(status).json({
        error: message,
        detail: detail
    });
}


// ===============================
// Kakao API 호출
// ===============================
async function kakaoFetch(url) {
    const response = await fetch(url, {
        headers: {
            Authorization: `KakaoAK ${KAKAO_REST_API_KEY}`
        }
    });

    const text = await response.text();

    let data;

    try {
        data = JSON.parse(text);
    } catch {
        throw new Error(
            `Kakao 서버가 JSON이 아닌 응답을 보냈습니다. (${response.status}) ${text.substring(0, 200)}`
        );
    }

    if (!response.ok) {
        throw new Error(
            data.message ||
            data.error_description ||
            `Kakao API 오류 (${response.status})`
        );
    }

    return data;
}


// ===============================
// 주소 검색
// ===============================
app.get("/api/geocode", async (req, res) => {

    // q와 query 둘 다 받을 수 있게 함
    const query = String(
        req.query.query || req.query.q || ""
    ).trim();

    console.log("주소 검색:", query);

    if (!query) {
        return jsonError(
            res,
            400,
            "검색어를 입력해 주세요."
        );
    }

    try {

        // -------------------------------
        // 1. Kakao 주소 검색
        // -------------------------------
        const addressUrl =
            "https://dapi.kakao.com/v2/local/search/address.json" +
            `?query=${encodeURIComponent(query)}`;

        const addressData = await kakaoFetch(addressUrl);

        if (
            addressData.documents &&
            addressData.documents.length > 0
        ) {
            const item = addressData.documents[0];

            return res.json({
                success: true,
                lat: Number(item.y),
                lng: Number(item.x),
                label: item.address_name || query
            });
        }


        // -------------------------------
        // 2. 주소 검색 결과가 없으면
        //    장소 검색
        // -------------------------------
        const keywordUrl =
            "https://dapi.kakao.com/v2/local/search/keyword.json" +
            `?query=${encodeURIComponent(query)}`;

        const keywordData = await kakaoFetch(keywordUrl);

        if (
            keywordData.documents &&
            keywordData.documents.length > 0
        ) {
            const item = keywordData.documents[0];

            return res.json({
                success: true,
                lat: Number(item.y),
                lng: Number(item.x),
                label:
                    item.place_name ||
                    item.address_name ||
                    query
            });
        }


        // 검색 결과 없음
        return jsonError(
            res,
            404,
            `"${query}" 검색 결과가 없습니다.`
        );

    } catch (error) {

        console.error("주소 검색 오류:", error);

        return jsonError(
            res,
            500,
            "주소 검색에 실패했습니다.",
            error.message
        );
    }
});


// ===============================
// 좌표 파싱
// frontend → lat,lng
// ===============================
function parseCoordinates(value) {

    if (!value) {
        return null;
    }

    const parts = String(value)
        .split(",")
        .map(Number);

    if (parts.length !== 2) {
        return null;
    }

    const lat = parts[0];
    const lng = parts[1];

    if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
    ) {
        return null;
    }

    if (lat < -90 || lat > 90) {
        return null;
    }

    if (lng < -180 || lng > 180) {
        return null;
    }

    return {
        lat,
        lng
    };
}


// ===============================
// 길찾기
// ===============================
app.get("/api/route", async (req, res) => {

    const start = parseCoordinates(
        req.query.start
    );

    const end = parseCoordinates(
        req.query.end
    );

    console.log("길찾기:", start, "→", end);

    if (!start || !end) {
        return jsonError(
            res,
            400,
            "출발지 또는 목적지 좌표가 올바르지 않습니다."
        );
    }

    try {

        // Kakao Mobility는
        // 경도,위도 순서로 보내야 함
        const origin =
            `${start.lng},${start.lat}`;

        const destination =
            `${end.lng},${end.lat}`;

        const url =
            "https://apis-navi.kakaomobility.com/v1/directions" +
            `?origin=${origin}` +
            `&destination=${destination}` +
            "&priority=RECOMMEND" +
            "&summary=false";

        const response = await fetch(url, {
            headers: {
                Authorization:
                    `KakaoAK ${KAKAO_REST_API_KEY}`
            }
        });

        const text = await response.text();

        let data;

        try {
            data = JSON.parse(text);
        } catch {
            return jsonError(
                res,
                502,
                "Kakao 길찾기 서버가 JSON이 아닌 응답을 보냈습니다.",
                text.substring(0, 300)
            );
        }

        if (!response.ok) {
            console.error(
                "Kakao 길찾기 오류:",
                response.status,
                data
            );

            return jsonError(
                res,
                response.status,
                data.msg ||
                data.message ||
                "Kakao 길찾기 API 오류",
                JSON.stringify(data)
            );
        }


        // -------------------------------
        // 경로 좌표 추출
        // -------------------------------
        const points = [];

        if (
            data.routes &&
            data.routes.length > 0
        ) {

            const sections =
                data.routes[0].sections || [];

            for (const section of sections) {

                const roads =
                    section.roads || [];

                for (const road of roads) {

                    const vertexes =
                        road.vertexes || [];

                    for (
                        let i = 0;
                        i < vertexes.length;
                        i += 2
                    ) {

                        const lng = vertexes[i];
                        const lat = vertexes[i + 1];

                        if (
                            Number.isFinite(lat) &&
                            Number.isFinite(lng)
                        ) {
                            points.push([
                                lat,
                                lng
                            ]);
                        }
                    }
                }
            }
        }


        // -------------------------------
        // 거리 / 시간
        // -------------------------------
        let distance = 0;
        let duration = 0;
        let fare = null;

        if (
            data.routes &&
            data.routes[0] &&
            data.routes[0].summary
        ) {

            const summary =
                data.routes[0].summary;

            distance =
                summary.distance || 0;

            duration =
                summary.duration || 0;

            fare =
                summary.fare || null;
        }


        return res.json({
            source: "kakao",
            distance,
            duration,
            points,
            fare
        });

    } catch (error) {

        console.error(
            "길찾기 서버 오류:",
            error
        );

        return jsonError(
            res,
            500,
            "길찾기 서버 오류",
            error.message
        );
    }
});


// ===============================
// 메인 페이지
// ===============================
app.get("/", (req, res) => {
    res.sendFile(
        path.join(__dirname, "gps.html")
    );
});


// ===============================
// 서버 시작
// ===============================
app.listen(PORT, () => {

    console.log(
        `GPS 서버 실행 중: http://localhost:${PORT}`
    );

});

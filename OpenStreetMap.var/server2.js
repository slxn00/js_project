const express = require("express");
const path = require("path");
const { exec } = require("child_process");

const app = express();
const PORT = 4000;

const SCHOOL = {
    lat: 37.46646,
    lng: 126.93289
};

const RADIUS = 100;

app.use(express.json());

// index.html 보여주기
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// 두 위치 사이의 거리 계산
function distance(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const rad = Math.PI / 180;

    const dLat = (lat2 - lat1) * rad;
    const dLng = (lng2 - lng1) * rad;

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * rad) *
        Math.cos(lat2 * rad) *
        Math.sin(dLng / 2) ** 2;

    return R * 2 * Math.atan2(
        Math.sqrt(a),
        Math.sqrt(1 - a)
    );
}

// 출석 확인
app.post("/api/attendance", (req, res) => {
    const { name, lat, lng } = req.body;

    const meters = Math.round(
        distance(
            SCHOOL.lat,
            SCHOOL.lng,
            lat,
            lng
        )
    );

    if (meters > RADIUS) {
        return res.json({
            attendance: false,
            distance: meters,
            message: "학교에서 100m 밖에 있습니다."
        });
    }

    console.log(`${name} 출석 / ${meters}m`);

    res.json({
        attendance: true,
        distance: meters,
        message: "출석이 인정되었습니다."
    });
});

// 서버 실행
app.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;

    console.log(url);

    // Windows에서 자동으로 브라우저 열기
    exec(`start ${url}`);
});

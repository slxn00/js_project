
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function send(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
        },
    });
}

// 학교 이름 비교: OO고 / OO고등학교 표기 차이 처리
function normalize(name) {
    return String(name)
        .replace(/[\s·()]/g, "")
        .replace(/고등학교$/, "고")
        .replace(/중학교$/, "중")
        .replace(/초등학교$/, "초");
}

// 나이스 API 요청
async function neisRequest(endpoint, params, page = 1) {
    const apiKey = Deno.env.get("NEIS_API_KEY");

    if (!apiKey) {
        throw new Error("NEIS_API_KEY가 등록되지 않았습니다.");
    }

    const url = new URL(
        `https://open.neis.go.kr/hub/${endpoint}`
    );

    const query = {
        KEY: apiKey,
        Type: "json",
        pIndex: String(page),
        pSize: "1000",
        ...params,
    };

    for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
    }

    const response = await fetch(url, {
        signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
        throw new Error(`나이스 서버 오류: ${response.status}`);
    }

    const result = await response.json();

    if (result.RESULT?.CODE === "INFO-200") {
        return { rows: [], count: 0 };
    }

    if (result.RESULT?.CODE) {
        throw new Error(
            result.RESULT.MESSAGE || result.RESULT.CODE
        );
    }

    const blocks = result[endpoint];

    if (!Array.isArray(blocks)) {
        throw new Error("나이스 API 응답 형식이 올바르지 않습니다.");
    }

    const head = blocks[0]?.head || [];
    const status = head.find(item => item.RESULT)?.RESULT;

    if (status?.CODE && status.CODE !== "INFO-000") {
        throw new Error(status.MESSAGE || status.CODE);
    }

    const total = head.find(
        item => item.list_total_count !== undefined
    )?.list_total_count || 0;

    return {
        rows: blocks[1]?.row || [],
        count: Number(total),
    };
}

// 조회 결과가 여러 페이지인 경우 모두 가져오기
async function getAllRows(endpoint, params) {
    const first = await neisRequest(endpoint, params);
    const rows = [...first.rows];
    const pages = Math.ceil(first.count / 1000);

    if (pages > 5) {
        throw new Error("검색 결과가 너무 많습니다.");
    }

    for (let page = 2; page <= pages; page++) {
        const next = await neisRequest(endpoint, params, page);
        rows.push(...next.rows);
    }

    return rows;
}

// 학급에 저장된 학교명으로 학교 코드 검색
async function findSchools(schoolName) {
    const shortened = normalize(schoolName)
        .replace(/(고|중|초)$/, "");

    const queries = [...new Set(
        [schoolName, shortened].filter(Boolean)
    )];

    for (const query of queries) {
        const rows = await getAllRows("schoolInfo", {
            SCHUL_NM: query,
        });

        const schools = rows
            .filter(row =>
                normalize(row.SCHUL_NM) === normalize(schoolName)
            )
            .map(row => ({
                name: row.SCHUL_NM,
                officeCode: row.ATPT_OFCDC_SC_CODE,
                schoolCode: row.SD_SCHUL_CODE,
                address: row.ORG_RDNMA || "",
            }))
            .filter(school =>
                school.officeCode && school.schoolCode
            );

        if (schools.length > 0) {
            return [...new Map(
                schools.map(school => [
                    `${school.officeCode}-${school.schoolCode}`,
                    school,
                ])
            ).values()];
        }
    }

    return [];
}

// 선택한 학교의 해당 월 학사일정 조회
async function getSchedule(school, year, month) {
    const ym = `${year}${String(month).padStart(2, "0")}`;
    const lastDay = new Date(year, month, 0).getDate();

    const rows = await getAllRows("SchoolSchedule", {
        ATPT_OFCDC_SC_CODE: school.officeCode,
        SD_SCHUL_CODE: school.schoolCode,
        AA_FROM_YMD: `${ym}01`,
        AA_TO_YMD: `${ym}${String(lastDay).padStart(2, "0")}`,
    });

    return rows
        .filter(row => row.AA_YMD?.startsWith(ym))
        .map(row => ({
            date: row.AA_YMD,
            name: row.EVENT_NM || "이름 없는 일정",
            description: row.EVENT_CNTNT || "",
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
}

// 브라우저에서 요청이 들어오는 부분
Deno.serve(async (request) => {
    if (request.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    if (request.method !== "POST") {
        return send({ message: "POST 요청만 가능합니다." }, 405);
    }

    try {
        const auth = request.headers.get("Authorization");

        if (!auth?.startsWith("Bearer ")) {
            return send({ message: "로그인이 필요합니다." }, 401);
        }

        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

        if (!supabaseUrl || !anonKey) {
            throw new Error("Supabase 서버 설정을 확인해 주세요.");
        }

        const headers = {
            Authorization: auth,
            apikey: anonKey,
        };

        // 로그인한 사용자인지 확인
        const userResponse = await fetch(
            `${supabaseUrl}/auth/v1/user`,
            { headers }
        );

        if (!userResponse.ok) {
            return send({ message: "로그인이 만료되었습니다." }, 401);
        }

        const user = await userResponse.json();

        const {
            classroomId,
            year,
            month,
            officeCode,
            schoolCode,
        } = await request.json();

        if (
            !/^[0-9a-f-]{36}$/i.test(classroomId || "") ||
            !Number.isInteger(year) ||
            year < 2020 || year > 2100 ||
            !Number.isInteger(month) ||
            month < 1 || month > 12
        ) {
            return send({ message: "조회 정보가 잘못되었습니다." }, 400);
        }

        // 관리자가 소유한 학급만 조회
        const classUrl = new URL(
            `${supabaseUrl}/rest/v1/checkin_classrooms`
        );

        classUrl.searchParams.set("select", "id,school_name");
        classUrl.searchParams.set("id", `eq.${classroomId}`);
        classUrl.searchParams.set("owner_id", `eq.${user.id}`);

        const classResponse = await fetch(classUrl, {
            headers,
        });

        if (!classResponse.ok) {
            throw new Error("학급 정보를 가져오지 못했습니다.");
        }

        const classrooms = await classResponse.json();
        const classroom = classrooms[0];

        if (!classroom) {
            return send({
                message: "관리 중인 학급을 찾을 수 없습니다.",
            }, 403);
        }

        const schoolName = classroom.school_name;

        if (!schoolName) {
            return send({
                message: "학급에 등록된 학교명이 없습니다.",
            }, 400);
        }

        // 나이스 학교 코드 조회
        const schools = await findSchools(schoolName);

        if (schools.length === 0) {
            return send({
                message: `${schoolName} 학교를 나이스에서 찾지 못했습니다.`,
            }, 404);
        }

        // 같은 이름의 학교가 여러 곳이면 사용자에게 선택 요청
        const selected = schools.find(school =>
            school.officeCode === officeCode &&
            school.schoolCode === schoolCode
        );

        if (!selected && schools.length > 1) {
            return send({
                status: "choose-school",
                schools,
            });
        }

        const school = selected || schools[0];
        const events = await getSchedule(school, year, month);

        return send({
            status: "ok",
            school,
            events,
        });

    } catch (error) {
        console.error("NEIS ERROR:", error);

        return send({
            message: error.message || "학사일정 조회에 실패했습니다.",
        }, 500);
    }
});

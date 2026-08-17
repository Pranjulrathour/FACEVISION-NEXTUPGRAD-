// k6 load test for the FaceVision backend.
// Run with: k6 run deployment/scripts/load-test.js
// Override target with: k6 run -e BASE_URL=http://localhost:8000 deployment/scripts/load-test.js
import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8000";

export const options = {
  scenarios: {
    steady_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "20s", target: 20 },
        { duration: "40s", target: 20 },
        { duration: "10s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
  },
};

function sampleDetection(id) {
  return JSON.stringify({
    id,
    mode: "upload",
    faceCount: 1,
    averageConfidence: 0.9,
    imageName: "load-test.jpg",
    userSessionId: "load-test-session",
    faces: [
      {
        box: { x: 10, y: 10, width: 100, height: 100 },
        confidence: 0.9,
        landmarks: {
          rightEye: { x: 30, y: 30 },
          leftEye: { x: 70, y: 30 },
          nose: { x: 50, y: 50 },
          rightMouth: { x: 35, y: 70 },
          leftMouth: { x: 65, y: 70 },
        },
      },
    ],
  });
}

export default function () {
  const health = http.get(`${BASE_URL}/api/health`);
  check(health, { "health is 200": (r) => r.status === 200 });

  const id = `loadtest-${__VU}-${__ITER}-${Date.now()}`;
  const createRes = http.post(`${BASE_URL}/api/detections`, sampleDetection(id), {
    headers: { "Content-Type": "application/json" },
  });
  check(createRes, {
    "detection create is 200 or 429": (r) => r.status === 200 || r.status === 429,
  });

  const statsRes = http.get(`${BASE_URL}/api/stats`);
  check(statsRes, { "stats is 200": (r) => r.status === 200 });

  sleep(1);
}

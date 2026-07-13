/**
 * On Par Waitlist stress test — 200 VUs × 5 minutes
 *
 * Run:
 *   k6 run web/scripts/k6-stress.js
 *   k6 run -e BASE_URL=https://onparwaitlist.com web/scripts/k6-stress.js
 *
 * Mix: ~70% board, ~15% home, ~10% health, ~5% join (no SMS).
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE_URL = (__ENV.BASE_URL || "https://onparwaitlist.com").replace(
  /\/$/,
  "",
);

const errorRate = new Rate("errors");
const boardLatency = new Trend("board_ms");
const joinLatency = new Trend("join_ms");

export const options = {
  scenarios: {
    stress: {
      executor: "constant-vus",
      vus: 200,
      duration: "5m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<3000", "p(99)<8000"],
    errors: ["rate<0.05"],
  },
};

const ACTIVITIES = ["bowling", "darts", "pool", "shuffleboard"];

function uniquePhone() {
  // 10-digit US-style fake numbers unique per VU iteration
  const n = `${__VU}${__ITER}${Date.now()}`.replace(/\D/g, "").slice(-10);
  return n.padStart(10, "5");
}

export default function () {
  const roll = Math.random();

  if (roll < 0.7) {
    const res = http.get(`${BASE_URL}/api/waitlist/board`, {
      tags: { name: "board" },
    });
    boardLatency.add(res.timings.duration);
    const ok = check(res, {
      "board 200": (r) => r.status === 200,
      "board has activities": (r) => {
        try {
          const body = r.json();
          return Array.isArray(body.board) && body.board.length === 4;
        } catch {
          return false;
        }
      },
    });
    errorRate.add(!ok);
  } else if (roll < 0.85) {
    const res = http.get(`${BASE_URL}/`, { tags: { name: "home" } });
    const ok = check(res, { "home 200": (r) => r.status === 200 });
    errorRate.add(!ok);
  } else if (roll < 0.95) {
    const res = http.get(`${BASE_URL}/api/waitlist/health`, {
      tags: { name: "health" },
    });
    const ok = check(res, {
      "health 200": (r) => r.status === 200,
      "storage writable": (r) => {
        try {
          return r.json().storage?.canWrite === true;
        } catch {
          return false;
        }
      },
    });
    errorRate.add(!ok);
  } else {
    const activity = ACTIVITIES[Math.floor(Math.random() * ACTIVITIES.length)];
    const payload = JSON.stringify({
      activity,
      firstName: `Load${__VU}`,
      lastName: `Test${__ITER}`,
      phone: uniquePhone(),
      smsOptIn: false,
      rewardsOptIn: false,
      laneCount: 1,
      sessionMinutes: 30,
    });
    const res = http.post(`${BASE_URL}/api/waitlist/join`, payload, {
      headers: { "Content-Type": "application/json" },
      tags: { name: "join" },
    });
    joinLatency.add(res.timings.duration);
    const ok = check(res, {
      "join 200": (r) => r.status === 200,
      "join has entry": (r) => {
        try {
          return Boolean(r.json().entry?.id);
        } catch {
          return false;
        }
      },
    });
    errorRate.add(!ok);
  }

  sleep(0.5 + Math.random() * 0.5);
}

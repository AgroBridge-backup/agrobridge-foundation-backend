import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 10 },
    { duration: '5m', target: 50 },
    { duration: '5m', target: 50 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.005'],
  },
};

let adminCookie = '';

export function setup() {
  const response = http.post(
    `${__ENV.BASE_URL || 'http://localhost:3000'}/api/auth/login`,
    JSON.stringify({
      email: __ENV.ADMIN_EMAIL || 'admin@agrobridge.org',
      password: __ENV.ADMIN_PASSWORD || 'test-password',
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    },
  );

  const cookies = response.headers['Set-Cookie'];
  if (cookies) {
    adminCookie = cookies;
  }

  return adminCookie;
}

export default function (cookie) {
  const page = Math.floor(Math.random() * 10) + 1;
  const pageSize = Math.floor(Math.random() * 50) + 10;
  const statuses = ['PENDING', 'SUCCEEDED', 'EXPIRED', ''];
  const status = statuses[Math.floor(Math.random() * statuses.length)];
  const sorts = ['createdAt:desc', 'createdAt:asc'];
  const sort = sorts[Math.floor(Math.random() * sorts.length)];
  const modes = ['offset', 'cursor'];
  const mode = modes[Math.floor(Math.random() * modes.length)];

  const queryParams = new URLSearchParams({
    mode,
    page,
    pageSize,
    status,
    sort,
  });

  const response = http.get(
    `${__ENV.BASE_URL || 'http://localhost:3000'}/api/admin/donations?${queryParams.toString()}`,
    {
      headers: { Cookie: cookie },
    },
  );

  check(response, {
    'donations list has items': (r) => r.json('data.items') !== undefined,
    'donations list has meta': (r) => r.json('data.meta') !== undefined,
    'items is an array': (r) => Array.isArray(r.json('data.items')),
  });

  sleep(Math.random() * 3 + 1);
}

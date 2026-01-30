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
    http_req_duration: ['p(95)<100'],
    http_req_failed: ['rate<0.01'],
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

  check(response, {
    'login successful': (r) => r.status === 200,
  });

  const cookies = response.headers['Set-Cookie'];
  if (cookies) {
    adminCookie = cookies;
  }

  return adminCookie;
}

export default function (cookie) {
  const response = http.get(`${__ENV.BASE_URL || 'http://localhost:3000'}/api/admin/dashboard`, {
    headers: { Cookie: cookie },
  });

  check(response, {
    'dashboard has totalDonations': (r) => r.json('data.totalDonations') !== undefined,
    'dashboard has totalAmount': (r) => r.json('data.totalAmount') !== undefined,
    'dashboard has uniqueDonors': (r) => r.json('data.uniqueDonors') !== undefined,
  });

  sleep(Math.random() * 4 + 2);
}

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10m', target: 50 },
    { duration: '100m', target: 50 },
    { duration: '10m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.001'],
  },
};

export default function () {
  const requestType = Math.random();

  if (requestType < 0.5) {
    http.post(
      `${__ENV.BASE_URL || 'http://localhost:3000'}/api/contacts`,
      JSON.stringify({
        name: `User${__VU}`,
        email: `user${__VU}@example.com`,
        message: 'Test message',
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } else {
    http.get(`${__ENV.BASE_URL || 'http://localhost:3000'}/api/health`);
  }

  sleep(Math.random() * 3 + 1);
}

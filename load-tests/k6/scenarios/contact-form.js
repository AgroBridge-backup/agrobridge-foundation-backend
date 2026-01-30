import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 50 },
    { duration: '5m', target: 100 },
    { duration: '5m', target: 100 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<200'],
    http_req_failed: ['rate<0.001'],
  },
};

export default function () {
  const payload = {
    name: `User${__VU}`,
    email: `user${__VU}@example.com`,
    message: `Test message from VU ${__VU}`,
  };

  const response = http.post(
    `${__ENV.BASE_URL || 'http://localhost:3000'}/api/contacts`,
    JSON.stringify(payload),
    {
      headers: { 'Content-Type': 'application/json' },
    },
  );

  check(response, {
    'contact form returns ok: true': (r) => r.json('ok') === true,
    'status is 200': (r) => r.status === 200,
  });

  sleep(Math.random() * 3 + 1);
}

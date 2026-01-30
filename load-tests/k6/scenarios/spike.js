import { exec } from 'k6/execution';
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 10 },
    { duration: '10s', target: 500 },
    { duration: '30s', target: 500 },
    { duration: '10s', target: 10 },
    { duration: '1m', target: 10 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    http_req_failed: ['rate<0.05'],
  },
};

export default function () {
  const requestType = Math.random();

  if (requestType < 0.3) {
    http.get(`${__ENV.BASE_URL || 'http://localhost:3000'}/api/health`);
  } else if (requestType < 0.7) {
    http.post(
      `${__ENV.BASE_URL || 'http://localhost:3000'}/api/contacts`,
      JSON.stringify({
        name: `User${exec.vu.idInInstance}`,
        email: `user${exec.vu.idInInstance}@example.com`,
        message: 'Test message during spike',
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } else {
    http.post(
      `${__ENV.BASE_URL || 'http://localhost:3000'}/api/donations/intent`,
      JSON.stringify({
        amount: Math.floor(Math.random() * 100000) + 1000,
        currency: 'usd',
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  sleep(Math.random() * 0.5 + 0.1);
}

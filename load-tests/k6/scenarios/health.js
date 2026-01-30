import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 100 },
    { duration: '2m', target: 1000 },
    { duration: '2m', target: 1000 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<10'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const response = http.get(`${__ENV.BASE_URL || 'http://localhost:3000'}/api/health`);

  check(response, {
    'health check returns ok status': (r) => r.json('data.status') === 'ok',
  });

  sleep(Math.random() * 0.5 + 0.1);
}

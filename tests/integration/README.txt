Integration/E2E tests requiring Postgres run via Testcontainers.

Prereq:
- Docker Desktop must be running (the daemon socket must be available).

Run:
- npm run test
- npm run test:coverage

When Docker is running, add full integration coverage for:
- src/api/routes/*
- src/repositories/*
- src/webhooks/*

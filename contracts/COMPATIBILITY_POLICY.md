# API Compatibility Policy

## Scope

This policy applies to contract-locked responses for:

- `POST /api/donations/intent`
- `POST /api/contacts`

Locked schemas live in:

- `contracts/schemas/post-api-donations-intent.response.v1.ts`
- `contracts/schemas/post-api-contacts.response.v1.ts`

OpenAPI snapshot lives in:

- `contracts/openapi/openapi.v1.snapshot.json`

## Backward-Compatibility Rules

For a versioned response schema (for example, `*.v1.ts`):

- Existing required fields must not be removed.
- Existing field types must remain compatible.
- Existing literal/enum constraints must not be narrowed incompatibly.
- Additive fields are allowed.

If a breaking change is intentional:

1. Add a new schema version file (for example, `*.v2.ts`).
2. Keep previous schema tests in place until consumers migrate.
3. Refresh and commit the OpenAPI snapshot.

## CI Enforcement

Run both checks in CI:

1. `npm run contracts:openapi:check` to detect uncommitted OpenAPI drift.
2. `npm run test:contracts` to enforce schema-lock backward compatibility.

Recommended single command:

- `npm run contracts:check`

## Snapshot Refresh Workflow

When API contracts change intentionally:

1. Update/add schema version files in `contracts/schemas/`.
2. Regenerate OpenAPI snapshot: `npm run contracts:openapi:export`.
3. Run verification: `npm run contracts:check`.
4. Commit all updated contract artifacts/tests together.

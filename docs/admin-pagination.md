# Admin Donations Pagination

This document describes pagination modes for `GET /api/admin/donations`.

## Background

Offset pagination (`page`/`pageSize`) is simple but becomes slower as the table grows because the database must scan/skip more rows.

Keyset (cursor) pagination is stable at large scale.

## Endpoint

`GET /api/admin/donations`

Common parameters:

- `pageSize` (max 100)
- `status` optional: `PENDING|SUCCEEDED|EXPIRED`
- `sort` supports `createdAt:desc` or `createdAt:asc`

### Mode: offset (default)

Parameters:

- `mode=offset` (default)
- `page` (default 1)

Response meta:

- `meta.mode = "offset"`
- `meta.page`, `meta.total`, `meta.totalPages`

### Mode: cursor

Parameters:

- `mode=cursor`
- `cursor` (optional)

Response meta:

- `meta.mode = "cursor"`
- `meta.nextCursor`

Cursor format:

- base64url JSON: `{ createdAt: ISOString, id: string }`

Notes:

- Cursor pagination uses deterministic ordering by `(createdAt, id)`.
- This avoids missing/duplicating rows when many donations have identical timestamps.

## Recommended Usage

- Use offset for low volume or quick admin manual browsing.
- Use cursor for heavy usage, exports, or large data sets.

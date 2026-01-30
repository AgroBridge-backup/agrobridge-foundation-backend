export type Cursor = {
  createdAt: string; // ISO
  id: string;
};

export function encodeCursor(cursor: { createdAt: Date; id: string }): string {
  const payload: Cursor = { createdAt: cursor.createdAt.toISOString(), id: cursor.id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const parsed = JSON.parse(raw) as Cursor;
  return { createdAt: new Date(parsed.createdAt), id: parsed.id };
}

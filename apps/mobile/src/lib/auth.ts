import * as SQLite from "expo-sqlite";

let _deviceId: string | null = null;
let _dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!_dbPromise) {
    _dbPromise = SQLite.openDatabaseAsync("fixsight.db").then(async (db) => {
      await db.execAsync(
        "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)"
      );
      return db;
    });
  }
  return _dbPromise;
}

function newId(): string {
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function getDeviceId(): Promise<string> {
  if (_deviceId) return _deviceId;
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'device_id'"
  );
  if (row) {
    _deviceId = row.value;
    return _deviceId;
  }
  const id = newId();
  await db.runAsync("INSERT INTO settings (key, value) VALUES ('device_id', ?)", id);
  _deviceId = id;
  return id;
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const id = await getDeviceId();
  return { "X-FixSight-User-Id": id };
}

import * as FileSystem from "expo-file-system/legacy";
import * as SQLite from "expo-sqlite";
import { parseAnalysis } from "./contract";
import type { Analysis, MediaType } from "./contract";

export interface HistoryRecord {
  id: string;
  serverScanId: string | null;
  parentScanId: string | null;
  createdAt: string;
  thumbnailUri: string;
  category: string | null;
  analysis: Analysis;
  resolved: boolean;
}

interface ScanRow {
  id: string;
  server_scan_id: string | null;
  parent_scan_id: string | null;
  created_at: string;
  thumbnail_uri: string;
  category: string | null;
  analysis_json: string;
  resolved: number;
}

export interface SaveHistoryInput {
  serverScanId: string | null;
  parentScanId: string | null;
  imageUri: string;
  imageMediaType: MediaType;
  category: string | null;
  analysis: Analysis;
}

const dbPromise = SQLite.openDatabaseAsync("fixsight.db");
let setupPromise: Promise<void> | null = null;

async function database(): Promise<SQLite.SQLiteDatabase> {
  const db = await dbPromise;
  setupPromise ??= db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS scans (
      id TEXT PRIMARY KEY NOT NULL,
      server_scan_id TEXT,
      parent_scan_id TEXT,
      created_at TEXT NOT NULL,
      thumbnail_uri TEXT NOT NULL,
      category TEXT,
      analysis_json TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS scans_created_at_idx ON scans(created_at DESC);
    CREATE INDEX IF NOT EXISTS scans_parent_idx ON scans(parent_scan_id);
  `);
  await setupPromise;
  return db;
}

function localId(): string {
  return `scan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function extension(mediaType: MediaType): string {
  if (mediaType === "image/png") return "png";
  if (mediaType === "image/webp") return "webp";
  return "jpg";
}

async function preserveImage(uri: string, id: string, mediaType: MediaType): Promise<string> {
  if (!FileSystem.documentDirectory) return uri;
  const directory = `${FileSystem.documentDirectory}scan-images/`;
  const destination = `${directory}${id}.${extension(mediaType)}`;
  try {
    const info = await FileSystem.getInfoAsync(directory);
    if (!info.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    await FileSystem.copyAsync({ from: uri, to: destination });
    return destination;
  } catch {
    return uri;
  }
}

function toRecord(row: ScanRow): HistoryRecord {
  return {
    id: row.id,
    serverScanId: row.server_scan_id,
    parentScanId: row.parent_scan_id,
    createdAt: row.created_at,
    thumbnailUri: row.thumbnail_uri,
    category: row.category,
    analysis: parseAnalysis(JSON.parse(row.analysis_json)),
    resolved: row.resolved === 1,
  };
}

export async function saveHistory(input: SaveHistoryInput): Promise<HistoryRecord> {
  const db = await database();
  const id = localId();
  const createdAt = new Date().toISOString();
  const thumbnailUri = await preserveImage(input.imageUri, id, input.imageMediaType);
  await db.runAsync(
    `INSERT INTO scans
      (id, server_scan_id, parent_scan_id, created_at, thumbnail_uri, category, analysis_json, resolved)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    id,
    input.serverScanId,
    input.parentScanId,
    createdAt,
    thumbnailUri,
    input.category,
    JSON.stringify(input.analysis),
  );
  return {
    id,
    serverScanId: input.serverScanId,
    parentScanId: input.parentScanId,
    createdAt,
    thumbnailUri,
    category: input.category,
    analysis: input.analysis,
    resolved: false,
  };
}

export async function listHistory(): Promise<HistoryRecord[]> {
  const db = await database();
  const rows = await db.getAllAsync<ScanRow>("SELECT * FROM scans ORDER BY created_at DESC");
  return rows.flatMap((row) => {
    try {
      return [toRecord(row)];
    } catch {
      return [];
    }
  });
}

export async function getHistoryScan(id: string): Promise<HistoryRecord | null> {
  const db = await database();
  const row = await db.getFirstAsync<ScanRow>("SELECT * FROM scans WHERE id = ?", id);
  if (!row) return null;
  try {
    return toRecord(row);
  } catch {
    return null;
  }
}

export async function setHistoryResolved(id: string, resolved: boolean): Promise<void> {
  const db = await database();
  await db.runAsync("UPDATE scans SET resolved = ? WHERE id = ?", resolved ? 1 : 0, id);
}

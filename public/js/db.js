// Device-local storage for inspections, customers, jobs, and settings.
//
// IndexedDB keeps photos and records on this device so saved inspections open
// offline. Nothing here leaves the device except through an explicit analysis
// request, export, or report. It is not a backup: clearing site data or losing
// the device loses it, so Settings offers a backup file.

const DB_NAME = "fixsight";
const DB_VERSION = 1;
const STORES = ["inspections", "customers", "jobs", "settings"];

let dbPromise = null;

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in globalThis)) {
      reject(new Error("This browser does not support offline storage."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("inspections")) {
        const store = db.createObjectStore("inspections", { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
        store.createIndex("jobId", "jobId");
        store.createIndex("parentId", "parentId");
      }
      if (!db.objectStoreNames.contains("customers")) {
        db.createObjectStore("customers", { keyPath: "id" }).createIndex("name", "name");
      }
      if (!db.objectStoreNames.contains("jobs")) {
        const store = db.createObjectStore("jobs", { keyPath: "id" });
        store.createIndex("customerId", "customerId");
        store.createIndex("updatedAt", "updatedAt");
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgraded the schema: close so it can proceed.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close other FixSight tabs and reload."));
  });
  return dbPromise;
}

async function tx(storeName, mode, run) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let result;
    Promise.resolve(run(store)).then((value) => {
      result = value;
    }, reject);
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Storage transaction aborted."));
  });
}

export async function put(storeName, value) {
  const record = { ...value, updatedAt: new Date().toISOString() };
  await tx(storeName, "readwrite", (store) => promisify(store.put(record)));
  return record;
}

export function get(storeName, id) {
  return tx(storeName, "readonly", (store) => promisify(store.get(id))).then((value) => value ?? null);
}

export function remove(storeName, id) {
  return tx(storeName, "readwrite", (store) => promisify(store.delete(id)));
}

export function all(storeName) {
  return tx(storeName, "readonly", (store) => promisify(store.getAll()));
}

export function byIndex(storeName, index, value) {
  return tx(storeName, "readonly", (store) => promisify(store.index(index).getAll(value)));
}

// ---------- settings ----------
export async function getSetting(key, fallback = null) {
  const row = await get("settings", key);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  await tx("settings", "readwrite", (store) => promisify(store.put({ key, value })));
}

// ---------- typed helpers ----------
export async function listInspections() {
  const items = await all("inspections");
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listJobs() {
  const items = await all("jobs");
  return items.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export async function listCustomers() {
  const items = await all("customers");
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

/** Deletes a customer and detaches (but keeps) their jobs. */
export async function deleteCustomer(id) {
  const jobs = await byIndex("jobs", "customerId", id);
  for (const job of jobs) await put("jobs", { ...job, customerId: null });
  await remove("customers", id);
}

/** Deletes a job and detaches (but keeps) its inspections. */
export async function deleteJob(id) {
  const inspections = await byIndex("inspections", "jobId", id);
  for (const inspection of inspections) await put("inspections", { ...inspection, jobId: null });
  await remove("jobs", id);
}

// ---------- backup ----------
export const BACKUP_FORMAT = "fixsight-backup-v1";

export async function exportAll() {
  const data = { format: BACKUP_FORMAT, exportedAt: new Date().toISOString() };
  for (const name of STORES) data[name] = await all(name);
  return data;
}

/** Merges a backup into local storage. Existing records with the same id are kept if newer. */
export async function importAll(data) {
  if (!data || data.format !== BACKUP_FORMAT) {
    throw new Error("This file is not a FixSight backup.");
  }
  let imported = 0;
  for (const name of STORES) {
    const rows = Array.isArray(data[name]) ? data[name] : [];
    for (const row of rows) {
      const keyName = name === "settings" ? "key" : "id";
      if (!row || typeof row[keyName] !== "string") continue;
      const existing = await get(name, row[keyName]);
      if (existing && name !== "settings" && (existing.updatedAt ?? "") > (row.updatedAt ?? "")) continue;
      await tx(name, "readwrite", (store) => promisify(store.put(row)));
      imported += 1;
    }
  }
  return imported;
}

export async function clearAll() {
  for (const name of STORES) {
    await tx(name, "readwrite", (store) => promisify(store.clear()));
  }
}

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try {
    return await navigator.storage.estimate();
  } catch {
    return null;
  }
}

/** Asks the browser not to evict our data under storage pressure. */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return navigator.storage?.persist ? await navigator.storage.persist() : false;
  } catch {
    return false;
  }
}

// IndexedDB 저장소 (회의, 할 일, 녹음 파일). 데이터는 이 기기 브라우저에만 저장됩니다.
const DB_NAME = "bms";
const DB_VERSION = 1;
const STORES = ["meetings", "todos", "audios"];

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: "id" });
          if (name !== "meetings") store.createIndex("meetingId", "meetingId");
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const result = fn(t.objectStore(store));
        t.oncomplete = () => resolve(result?.result ?? result);
        t.onerror = () => reject(t.error);
      })
  );
}

export const db = {
  all: (store) => tx(store, "readonly", (s) => s.getAll()),
  get: (store, id) => tx(store, "readonly", (s) => s.get(id)),
  put: (store, value) => tx(store, "readwrite", (s) => s.put(value)).then(() => value),
  delete: (store, id) => tx(store, "readwrite", (s) => s.delete(id)),
  byMeeting: (store, meetingId) =>
    tx(store, "readonly", (s) => s.index("meetingId").getAll(meetingId)),
};

export const newId = () =>
  (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);

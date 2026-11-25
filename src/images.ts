// Chapter illustrations live in IndexedDB (they are far too big for localStorage),
// keyed by chapter id and stored as compressed JPEG data URLs.

const DB = "taskututtor-images";
const STORE = "images";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export function getImage(id: string): Promise<string | undefined> {
  return tx<string | undefined>("readonly", (s) => s.get(id)).catch(() => undefined);
}

export function putImage(id: string, dataUrl: string): Promise<unknown> {
  return tx("readwrite", (s) => s.put(dataUrl, id));
}

export function deleteImage(id: string): Promise<unknown> {
  return tx("readwrite", (s) => s.delete(id)).catch(() => undefined);
}

/** Downscale to at most `max` px wide and re-encode as JPEG (≈100–200 KB instead of 1–2 MB). */
export function compress(dataUrl: string, max = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / img.naturalWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => reject(new Error("The illustration could not be read."));
    img.src = dataUrl;
  });
}

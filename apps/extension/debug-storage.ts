import { readDebugPage } from './debug-page';

const databaseName = 'storycursor-local-debug';
const storeName = 'captures';
const maxAge = 30 * 24 * 60 * 60 * 1000;
const maxCaptures = 50;
type Snapshot = ReturnType<typeof readDebugPage>['snapshot'];
type Capture = { id: string; at: number; confirmed: boolean; snapshot: Snapshot };

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function useStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
      run(tx.objectStore(storeName), result => { value = result; });
    });
  } finally {
    db.close();
  }
}

export async function captureNewManga(id: string, expectedUrl: string) {
  const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
  if (tab?.id === undefined || tab.url !== expectedUrl) return;
  const [result] = await chrome.scripting.executeScript({ target:{ tabId:tab.id }, func:readDebugPage });
  if (result?.result?.observedUrl !== expectedUrl) return;
  const capture: Capture = { id, at: Date.now(), confirmed:false, snapshot:result.result.snapshot };
  await useStore<void>('readwrite', store => {
    const query = store.getAll();
    query.onsuccess = () => {
      const previous = (query.result as Capture[]).sort((a,b) => b.at - a.at);
      previous.forEach((item, index) => {
        if (index >= maxCaptures - 1 || item.at < capture.at - maxAge) store.delete(item.id);
      });
      store.put(capture);
    };
  });
}

export function confirmDebugCapture(id: string) {
  return useStore<void>('readwrite', store => {
    const request = store.get(id);
    request.onsuccess = () => {
      const capture = request.result as Capture | undefined;
      if (capture) store.put({ ...capture, confirmed: true } satisfies Capture);
    };
  });
}

export function readDebugCaptures() {
  return useStore<Capture[]>('readwrite', (store, set) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const cutoff = Date.now() - maxAge;
      const captures = request.result as Capture[];
      for (const capture of captures) if (capture.at < cutoff) store.delete(capture.id);
      set(captures.filter(capture => capture.confirmed && capture.at >= cutoff).sort((a,b) => b.at - a.at));
    };
  });
}

export function clearDebugCaptures() {
  return useStore<void>('readwrite', store => { store.clear(); });
}

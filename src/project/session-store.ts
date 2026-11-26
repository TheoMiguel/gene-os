/** One write: values to store and keys to remove, applied together. */
export interface SessionWrite {
  readonly puts: Readonly<Record<string, unknown>>;
  readonly deletes: readonly string[];
}

/** Where the session lives. The browser uses IndexedDB; tests use memory. */
export interface SessionBackend {
  /** Every stored key and value. Rejects when the storage is unavailable. */
  readAll(): Promise<ReadonlyMap<string, unknown>>;
  /** Applies a write in one transaction: all of it or none of it. */
  write(change: SessionWrite): Promise<void>;
  clear(): Promise<void>;
}

const DATABASE = 'gene-os';
const STORE = 'session';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed')), {
      once: true,
    });
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('IndexedDB failed')), {
      once: true,
    });
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB aborted')), {
      once: true,
    });
  });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE, 1);
    request.addEventListener('upgradeneeded', () => request.result.createObjectStore(STORE), { once: true });
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB open failed')), {
      once: true,
    });
    request.addEventListener('blocked', () => reject(new Error('IndexedDB open blocked')), { once: true });
  });
}

/**
 * A backend on IndexedDB. Sequences reach megabases, far beyond what localStorage holds, and IndexedDB stores
 * them by structured clone without a JSON round trip. The connection opens on first use and reopens if the
 * browser closed it.
 */
export function indexedDbBackend(factory: IDBFactory | undefined = globalThis.indexedDB): SessionBackend {
  let connection: Promise<IDBDatabase> | null = null;
  const database = () => {
    if (!factory) return Promise.reject(new Error('IndexedDB is not available'));
    connection ??= openDatabase(factory).then((db) => {
      db.addEventListener('close', () => {
        connection = null;
      });
      db.addEventListener('versionchange', () => db.close());
      return db;
    });
    connection.catch(() => {
      connection = null;
    });
    return connection;
  };

  return {
    async readAll() {
      const db = await database();
      const transaction = db.transaction(STORE, 'readonly');
      const store = transaction.objectStore(STORE);
      const [keys, values] = await Promise.all([
        requestResult(store.getAllKeys()),
        requestResult(store.getAll()),
      ]);
      return new Map(keys.map((key, index) => [String(key), values[index]]));
    },
    async write({ puts, deletes }) {
      const db = await database();
      const transaction = db.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      for (const key of deletes) store.delete(key);
      for (const [key, value] of Object.entries(puts)) store.put(value, key);
      await transactionDone(transaction);
    },
    async clear() {
      const db = await database();
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).clear();
      await transactionDone(transaction);
    },
  };
}

/** A backend that keeps everything in memory, for tests and for browsers without IndexedDB. */
export function memoryBackend(): SessionBackend & { readonly data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async readAll() {
      return new Map(data);
    },
    async write({ puts, deletes }) {
      for (const key of deletes) data.delete(key);
      for (const [key, value] of Object.entries(puts)) data.set(key, structuredClone(value));
    },
    async clear() {
      data.clear();
    },
  };
}

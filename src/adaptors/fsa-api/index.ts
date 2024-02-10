/**
 * Uses the File System Access API to read and write files.
 * It will attempt to retrieve an existing handle from an indexedDB database.
 * If it cannot find one, it will prompt the user to select a directory.
 * @see https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API
*/
import { BaseAdaptor, BaseAdaptorOptions } from '../../base';
import { FileStat, PathMap } from '../../definitions';

const INDEXDB_VERSION = 0;
const INDEXDB_DEFAULT_DB = 'files-multitool';
const INDEXDB_DEFAULT_STORE = '~~fsa-api~~';

export interface FSAAdaptorOptions extends BaseAdaptorOptions {
  db?: string;
  store?: string;
  startIn?: 'documents' | 'desktop' | 'pictures' | 'music' | 'movies' | 'downloads';
}

interface HandlerItem {
  ref: string;
  handle: FileSystemDirectoryHandle;
}

interface PathCache {
  [path: string]: FileSystemHandle;
}

interface FileCacheItem {
  handler: FileSystemFileHandle;
  file: File;
}

export class FSAAdaptor extends BaseAdaptor {
  declare options: FSAAdaptorOptions;
  root: FileSystemDirectoryHandle | null = null;
  pathCache: PathCache = {};
  fileCache: FileCacheItem[] = [];

  get isInitialized(): boolean {
    return !!this.root;
  }

  static isSupported(): boolean {
    return typeof window !== 'undefined'
      && typeof window.indexedDB !== 'undefined'
      && typeof window.showDirectoryPicker !== 'undefined';
  }

  async _getFile(handle: FileSystemFileHandle): Promise<File> {
    const cached = this.fileCache.find(item => item.handler === handle);
    if (cached) return cached.file;
    const file = await handle.getFile();
    this.fileCache.push({
      handler: handle,
      file,
    });
    return file;
  }

  _purgeCache(handleOrPath?: FileSystemFileHandle | string): void {
    if (typeof handleOrPath === 'string') {
      delete this.pathCache[handleOrPath];
    } else if (handleOrPath) {
      const index = this.fileCache.findIndex(item => item.handler === handleOrPath);
      if (index >= 0) this.fileCache.splice(index, 1);
    } else {
      this.fileCache = [];
      this.pathCache = {};
    }
  }

  _getHandleFromDB(store: IDBObjectStore): Promise<FileSystemDirectoryHandle | null> {
    return new Promise((resolve, reject) => {
      const index = store.index('ref');
      const request = index.get(this.ref);
      request.onerror = (event) => {
        reject(event);
      };
      request.onsuccess = (event) => {
        const result = request.result as HandlerItem | undefined;
        resolve(result?.handle || null);
      };
    });
  }

  _saveHandleToDB(store: IDBObjectStore, handle: FileSystemDirectoryHandle): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = store.put({
        ref: this.ref,
        handle,
      });
      request.onerror = (event) => {
        reject(event);
      };
      request.onsuccess = (event) => {
        resolve();
      };
    });
  }

  _dropHandleFromDB(store: IDBObjectStore): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = store.delete(this.ref);
      request.onerror = (event) => {
        reject(event);
      };
      request.onsuccess = (event) => {
        resolve();
      };
    });
  }

  async _verifyHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    const opts = {
      mode: 'readwrite' as FileSystemPermissionMode,
    };

    const perm = await handle.queryPermission(opts);

    if (perm !== 'granted') {
      const newPerm = await handle.requestPermission(opts);

      if (newPerm !== 'granted') {
        throw new Error('Permission denied');
      }
    }
  }

  async init(): Promise<void> {
    const db = await new Promise((resolve, reject) => {
      const request = window.indexedDB.open(this.options.db || INDEXDB_DEFAULT_DB, INDEXDB_VERSION);
      request.onerror = (event) => {
        reject(event);
      };
      request.onsuccess = (event) => {
        resolve((event.target as any).result);
      };
      request.onupgradeneeded = (event) => {
        const db = (event.target as any).result as IDBDatabase;
        const store = db.createObjectStore(this.options.store || INDEXDB_DEFAULT_STORE, { keyPath: 'path' });
        
        store.createIndex('ref', 'ref', { unique: true });

        resolve(db);
      };
    }) as IDBDatabase;

    const store = db
      .transaction(this.options.store || INDEXDB_DEFAULT_STORE, 'readwrite')
      .objectStore(this.options.store || INDEXDB_DEFAULT_STORE);

    let handle = await this._getHandleFromDB(store);

    const startIn = this.options.startIn || 'documents';
    if (!handle) {
      handle = await window.showDirectoryPicker({
        id: this.ref,
        mode: 'readwrite',
        startIn,
      });
      await this._saveHandleToDB(store, handle);
    } else {
      try {
        await this._verifyHandle(handle);
      } catch (err) {
        await this._dropHandleFromDB(store);
        handle = await window.showDirectoryPicker({
          id: this.ref,
          mode: 'readwrite',
          startIn,
        });
        await this._saveHandleToDB(store, handle);
      }
    }

    this.root = handle;

    db.close();
  }

  async destroy(): Promise<void> {
    this.root = null;
    this._purgeCache();
  }

  async _getParentHandle(path: string, create?: boolean): Promise<FileSystemDirectoryHandle> {
    if (!this.isInitialized) throw new Error('Adaptor not initialized');
    if (path === '') return this.root!;
    if (this.pathCache[path]) return this.pathCache[path] as FileSystemDirectoryHandle;
    const parts = path.split('/');
    let handle = this.root!;
    for (let i = 0; i < parts.length - 1; i++) {
      handle = await handle.getDirectoryHandle(parts[i], { create });
    }
    this.pathCache[path] = handle;
    return handle;
  }

  async _getPathHandle(path: string, create?: boolean): Promise<FileSystemHandle> {
    if (!this.isInitialized) throw new Error('Adaptor not initialized');
    if (path === '') return this.root!;
    if (this.pathCache[path]) return this.pathCache[path];
    const parent = await this._getParentHandle(path, create);
    const subject = path.split('/').pop()!;

    for await (const [key, value] of parent.entries()) {
      if (key === subject) {
        this.pathCache[path] = value;
        return value;
      }
    }

    if (create) {
      const handler = subject.includes('.')
        ? await parent.getFileHandle(subject, { create })
        : await parent.getDirectoryHandle(subject, { create });
      this.pathCache[path] = handler;
      return handler;
    }

    throw new Error('Path not found');
  }

  async _getHandleStat(path: string, handle: FileSystemHandle): Promise<FileStat> {
    if (handle.kind === 'directory') {
      return {
        path,
        parentPath: path.split('/').slice(0, -1).join('/'),
        isDirectory: true,
        isFile: false,
        size: 0,
      };
    } else if (handle.kind === 'file') {
      let file = await this._getFile(handle as FileSystemFileHandle);
      return {
        path,
        parentPath: path.split('/').slice(0, -1).join('/'),
        isDirectory: false,
        isFile: true,
        size: file.size,
        modifiedTime: new Date(file.lastModified),
        createdTime: new Date(file.lastModified),
      };
    }

    throw new Error('Unknown handle type');
  }

  async stat (path: string): Promise<FileStat | null> {
    try {
      const handle = await this._getPathHandle(path);
      return this._getHandleStat(path, handle);
    } catch (err) {
      if (
        (err as Error).name === 'NotFoundError'
        || (err as Error).message === 'Path not found'
      ) return null;
      throw err;
    }
  }

  async readFile(path: string): Promise<Buffer> {
    const handle = await this._getPathHandle(path);
    if (handle.kind !== 'file') throw new Error('Not a file');
    const file = await this._getFile(handle as FileSystemFileHandle);
    const buffer = await file.arrayBuffer();
    return Buffer.from(buffer);
  }

  async writeFile(path: string, data: Buffer): Promise<void> {
    const parent = await this._getParentHandle(path);
    const fileName = path.split('/').pop()!;
    const file = await parent.getFileHandle(fileName, { create: true });
    const writable = await file.createWritable();
    await writable.write(data as ArrayBuffer);
    await writable.close();
    this._purgeCache(file);
  }

  async deleteFile(path: string): Promise<void> {
    const parent = await this._getParentHandle(path);
    const fileName = path.split('/').pop()!;

    try {
      const handle = await parent.getFileHandle(fileName);
      this._purgeCache(handle);
      this._purgeCache(path);
    } catch (err) {
      // ignore
    }

    await parent.removeEntry(fileName);
  }

  async list(path: string): Promise<PathMap> {
    const handle = await this._getPathHandle(path) as FileSystemDirectoryHandle;
    if (handle.kind !== 'directory') throw new Error('Not a directory');

    const map: PathMap = {};
    for await (const [key, value] of handle.entries()) {
      const fullPath = [path, key].join('/');
      map[fullPath] = await this._getHandleStat(fullPath, value) ;
    }

    return map;
  }

  async mkdir(path: string): Promise<void> {
    const parent = await this._getParentHandle(path);
    const dirName = path.split('/').pop()!;
    await parent.getDirectoryHandle(dirName, { create: true });
  }

  async rmdir(path: string): Promise<void> {
    const parent = await this._getParentHandle(path);
    const dirName = path.split('/').pop()!;
    await parent.removeEntry(dirName, { recursive: true });
    await this._purgeCache();
  }

  async _copyFile(
    path: string,
    targetPath: string,
    newFileName?: string,
  ): Promise<void> {
    const source = await this._getPathHandle(path) as FileSystemFileHandle;
    const destination = await this._getPathHandle(targetPath, true) as FileSystemDirectoryHandle;
    const file = await this._getFile(source);
    const newFile = await destination.getFileHandle(newFileName || source.name, { create: true });
    const writer = await newFile.createWritable();
    await writer.write(file);
    await writer.close();
    this._purgeCache(newFile);
  }

  async _copyDirectory(
    path: string,
    targetPath: string,
    recursive?: boolean,
  ): Promise<void> {
    const source = await this._getPathHandle(path) as FileSystemDirectoryHandle;
    await this._getPathHandle(targetPath, true);
    for await (const [key, value] of source.entries()) {
      const fullPath = [path, key].join('/');
      const fullTargetPath = [targetPath, key].join('/');
      if (value.kind === 'directory' && recursive) {
        await this._copyDirectory(fullPath, fullTargetPath, recursive);
      } else if (value.kind === 'file') {
        await this._copyFile(fullPath, targetPath);
      }
    }
  }

  async isDirectory(path: string): Promise<boolean> {
    const handle = await this._getPathHandle(path);
    return handle.kind === 'directory';
  }

  async isFile(path: string): Promise<boolean> {
    const handle = await this._getPathHandle(path);
    return handle.kind === 'file';
  }
}

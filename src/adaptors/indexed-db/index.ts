import { BaseAdaptor, BaseAdaptorOptions } from '../../base';
import { FileStat, PathMap } from '../../definitions';

const INDEXEDDB_VERSION = 1;
// const INDEXEDDB_DEFAULT_DB = 'files-multitool';
const INDEXEDDB_DEFAULT_STORE = 'files';

export interface IndexedDBAdaptorOptions extends BaseAdaptorOptions {
  db?: string;
}

interface IndexedDBFileStat extends FileStat {
  content?: string;
  deletedAt?: Date;
}

const joinPath = (path: string, fileName: string) => {
  return [
    path.replace(/\/$/, ''),
    fileName.replace(/^\//, ''),
  ].filter(v => v).join('/');
}

export class IndexedDBAdaptor extends BaseAdaptor {
  declare options: IndexedDBAdaptorOptions;
  db = null as IDBDatabase | null;
  indexedDB = null as IDBFactory | null;

  get isInitialized(): boolean {
    return !!this.db;
  };

  static isSupported(): boolean {
    return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
  }

  async init(): Promise<void> {
    this.indexedDB = window.indexedDB;
    this.db = await new Promise((resolve, reject) => {
      const request = this.indexedDB!.open(this.ref, INDEXEDDB_VERSION);
      request.onerror = (event) => {
        reject(event);
      };
      request.onsuccess = (event) => {
        resolve((event.target as any).result);
      };
      request.onupgradeneeded = (event) => {
        const db = (event.target as any).result as IDBDatabase;
        const store = db.createObjectStore(INDEXEDDB_DEFAULT_STORE, { keyPath: 'path' });
        
        store.createIndex('path', 'path', { unique: true });
        store.createIndex('isDirectory', 'isDirectory', { unique: false });
        store.createIndex('isFile', 'isFile', { unique: false });
        store.createIndex('size', 'size', { unique: false });
        store.createIndex('modifiedTime', 'modifiedTime', { unique: false });
        store.createIndex('createdTime', 'createdTime', { unique: false });
        store.createIndex('parentPath', 'parentPath', { unique: false });
        store.createIndex('deletedAt', 'deletedAt', { unique: false });

        // resolve(db);
      };
    }) as IDBDatabase;

    this.db.addEventListener('close', () => {
      super.destroy();
      this.db = null;
    });

    return super.init();
  }

  destroy(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    return super.destroy();
  }

  // internal helper methods

  _convertFileStat(stat: IndexedDBFileStat): FileStat {
    const clonedStat = { ...stat };
    delete clonedStat.content;
    delete clonedStat.deletedAt;
    return clonedStat;
  }

  _getStore(): IDBObjectStore {
    if (!this.isInitialized) {
      throw new Error('Adaptor is not initialized.');
    }
    return this.db!
      .transaction(INDEXEDDB_DEFAULT_STORE, 'readwrite')
      .objectStore(INDEXEDDB_DEFAULT_STORE);
  }

  _getItem(path: string): Promise<IndexedDBFileStat | null> {
    const store = this._getStore();
    const request = store.get(path);
    return new Promise((resolve, reject) => {
      request.onerror = (event) => {
        reject(request.error);
      };
      request.onsuccess = (event) => {
        resolve((request.result || null) as IndexedDBFileStat | null);
      };
    });
  }

  _removeItem(path: string): Promise<void> {
    const store = this._getStore();
    const request = store.delete(path);
    return new Promise((resolve, reject) => {
      request.onerror = (event) => {
        reject(request.error);
      };
      request.onsuccess = (event) => {
        resolve();
      };
    });
  }

  async _putItem(stat: IndexedDBFileStat): Promise<IndexedDBFileStat> {
    let writeStat = stat;
    const existing = await this._getItem(stat.path);
    if (existing && existing.deletedAt) {
      await this._removeItem(stat.path);
    } else if (existing) {
      writeStat = {
        ...stat,
        createdTime: existing.createdTime,
      };
    }
    const store = this._getStore();
    const request = store.put(writeStat);
    return new Promise((resolve, reject) => {
      request.onerror = (event) => {
        reject(request.error);
      };
      request.onsuccess = (event) => {
        resolve(writeStat);
      };
    });
  }

  _listItems(path: string): Promise<IndexedDBFileStat[]> {
    const store = this._getStore();
    const index = store.index('parentPath');
    const request = index.getAll(path);
    return new Promise((resolve, reject) => {
      request.onerror = (event) => {
        reject(request.error);
      };
      request.onsuccess = (event) => {
        resolve((request.result || []) as IndexedDBFileStat[]);
      };
    });
  }

  // adaptor methods

  async stat(path: string): Promise<FileStat | null> {
    const stat = await this._getItem(path);
    if (!stat || stat.deletedAt) return null;
    return this._convertFileStat(stat);
  }

  async readFile(path: string): Promise<Buffer> {
    const stat = await this._getItem(path);
    if (!stat || stat.deletedAt) {
      throw new Error('File not found.');
    }
    if (stat.isDirectory) {
      throw new Error('Cannot read a directory.');
    }
    return Buffer.from(stat.content || '', 'base64');
  }

  async writeFile(path: string, content: Buffer): Promise<void> {
    await this._putItem({
      path,
      parentPath: path.split('/').slice(0, -1).join('/')
        .replace(/(^\/)|(\/$)/g, ''),
      isDirectory: false,
      isFile: true,
      size: content.length,
      modifiedTime: new Date(),
      createdTime: new Date(),
      content: content.toString('base64'),
    });
  }

  async deleteFile(path: string): Promise<void> {
    const stat = await this._getItem(path);
    if (!stat || stat.deletedAt) {
      throw new Error('File not found.');
    }
    await this._putItem({
      ...stat,
      deletedAt: new Date(),
    });
  }

  async list(path: string): Promise<PathMap> {
    const items = await this._listItems(path);
    const result: PathMap = {};
    for (const item of items) {
      if (item.deletedAt) continue;
      result[item.path] = this._convertFileStat(item);
    }
    return result;
  }

  async mkdir(path: string): Promise<void> {
    const parts = path.replace(/(^\/)|(\/$)/g, '').split('/');
    for (let i = 0; i < parts.length; i++) {
      const partPath = parts.slice(0, i + 1).join('/');
      const stat = await this._getItem(partPath);
      if (!stat || stat.deletedAt) {
        await this._putItem({
          path: partPath,
          parentPath: partPath.split('/').slice(0, -1).join('/')
            .replace(/(^\/)|(\/$)/g, ''),
          isDirectory: true,
          isFile: false,
          size: 0,
          modifiedTime: new Date(),
          createdTime: new Date(),
        });
      }
    }
  }

  async rmdir(path: string): Promise<void> {
    const stat = await this._getItem(path);
    if (!stat || stat.deletedAt) {
      throw new Error('Directory not found.');
    }
    const items = await this._listItems(path);
    for (const item of items) {
      if (item.deletedAt) continue;
      const itemPath = joinPath(path, item.path.split('/').pop() as string);
      if (item.isDirectory) {
        await this.rmdir(itemPath);
      } else {
        await this.deleteFile(itemPath);
      }
    }
    await this._putItem({
      ...stat,
      deletedAt: new Date(),
    });
  }

  async _copyFile(path: string, targetPath: string, newFileName?: string): Promise<void> {
    const stat = await this._getItem(path);
    if (!stat || stat.deletedAt) {
      throw new Error('File not found.');
    }
    const fileName = newFileName || stat.path.split('/').pop()!;
    await this._putItem({
      ...stat,
      path: joinPath(targetPath, fileName),
      parentPath: targetPath,
    });
  }

  async _copyDirectory(path: string, newPath: string, recursive?: boolean): Promise<void> {
    const stat = await this._getItem(path);
    if (!stat || stat.deletedAt) {
      throw new Error('Directory not found.');
    }
    const items = await this._listItems(path);
    await this.mkdir(newPath);
    for (const item of items) {
      if (item.deletedAt) continue;
      const itemPath = joinPath(path, item.path.split('/').pop() as string);
      if (item.isDirectory && recursive) {
        const newItemPath = joinPath(newPath, item.path.split('/').pop() as string);
        await this._copyDirectory(itemPath, newItemPath, recursive);
      } else if (item.isFile) {
        await this._copyFile(itemPath, newPath);
      }
    }
  }

}
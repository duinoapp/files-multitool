import { FSAAdaptor, FSAAdaptorOptions } from './adaptors/fsa-api';
import { IndexDBAdaptor, IndexDBAdaptorOptions } from './adaptors/indexdb';
import { FileStat, PathMap } from './definitions';
import { BaseAdaptor, BaseAdaptorOptions } from './base';

export enum FilesMultitoolType {
  FSA_API = 'fsa-api',
  INDEXDB = 'indexdb',
}

export interface FilesMultitoolPrettyTypes {
  text: string;
  technology: string;
  value: FilesMultitoolType;
}

const cleanPath = (path: string) => {
  if (!path) return '';
  if (path.includes('..')) throw new Error('Invalid path.');
  return path
    .replace(/\/+/g, '/')
    .replace(/(^\/)|(\/$)/g, '');
};

export class FilesMultitool {
  protected type: FilesMultitoolType;
  protected ref: string;
  protected options: BaseAdaptorOptions;
  protected adaptor: BaseAdaptor;

  constructor(type: FilesMultitoolType, ref: string, options: FSAAdaptorOptions | IndexDBAdaptorOptions = {}) {
    if (!ref) throw new Error('Reference is required.');
    this.type = type;
    this.ref = ref;
    this.options = options;
    switch (type) {
      case FilesMultitoolType.FSA_API:
        this.adaptor = new FSAAdaptor(ref, options as FSAAdaptorOptions);
      case FilesMultitoolType.INDEXDB:
        this.adaptor = new IndexDBAdaptor(ref, options as IndexDBAdaptorOptions);
      default:
        throw new Error('Unsupported adaptor type.');
    }
  }

  
  static isSupported(type: FilesMultitoolType): boolean {
    switch (type) {
      case FilesMultitoolType.FSA_API:
        return FSAAdaptor.isSupported();
      case FilesMultitoolType.INDEXDB:
        return IndexDBAdaptor.isSupported();
      default:
        return false;
    }
  }
        
  static getTypes(): FilesMultitoolPrettyTypes[] {
    return [
      {
        technology: 'File System Access API',
        text: 'Computer File System',
        value: FilesMultitoolType.FSA_API,
      },
      {
        technology: 'IndexedDB',
        text: 'Local Browser Storage',
        value: FilesMultitoolType.INDEXDB,
      },
    ].filter(type => FilesMultitool.isSupported(type.value));
  }

  async init(): Promise<void> {
    await this.adaptor.init();
  }

  async destroy(): Promise<void> {
    await this.adaptor.destroy();
  }

  get isInitialized(): boolean {
    return !!this.adaptor?.isInitialized;
  }

  async stat(path: string): Promise<FileStat | null> {
    path = cleanPath(path);
    return this.adaptor.stat(path);
  }

  async list(path: string, recursive?: boolean): Promise<PathMap> {
    path = cleanPath(path);
    const map = {} as PathMap;
    const root = this.adaptor.list(path);
    for (const [key, value] of Object.entries(root)) {
      map[key] = value;
      if (value.isDirectory && recursive) {
        const children = await this.list(value.path, recursive);
        Object.assign(map, children);
      }
    }
    return map;
  }

  async readFile(path: string, encoding: BufferEncoding = 'utf-8'): Promise<string> {
    path = cleanPath(path);
    const stat = await this.adaptor.stat(path);
    if (!stat) throw new Error('File not found.');
    if (stat.isDirectory) throw new Error('Cannot read a directory.');
    const buffer = await this.adaptor.readFile(path);
    return buffer.toString(encoding);
  }

  async writeFile(path: string, content: string | Buffer, encoding: BufferEncoding = 'utf-8'): Promise<void> {
    path = cleanPath(path);
    const stat = await this.adaptor.stat(path);
    if (stat?.isDirectory) throw new Error('Cannot write to a directory.');
    if (typeof content === 'string') {
      content = Buffer.from(content, encoding);
    }
    await this.adaptor.writeFile(path, content);
  }

  async deleteFile(path: string): Promise<void> {
    path = cleanPath(path);
    const stat = await this.adaptor.stat(path);
    if (!stat) throw new Error('File not found.');
    if (stat.isDirectory) throw new Error('Cannot delete a directory.');
    await this.adaptor.deleteFile(path);
  }

  mkdir(path: string): Promise<void> {
    path = cleanPath(path);
    return this.adaptor.mkdir(path);
  }

  async rmdir(path: string, recursive?: boolean): Promise<void> {
    path = cleanPath(path);
    const stat = await this.adaptor.stat(path);
    if (!stat) throw new Error('Directory not found.');
    if (!stat.isDirectory) throw new Error('Cannot delete a file.');
    const children = this.adaptor.list(path);
    if (Object.keys(children).length && !recursive) throw new Error('Directory is not empty.');
    return this.adaptor.rmdir(path);
  }

  async copy(source: string, destination: string, recursive?: boolean): Promise<void> {
    source = cleanPath(source);
    destination = cleanPath(destination);
    const sourceStat = await this.adaptor.stat(source);
    if (!sourceStat) throw new Error('Source not found.');
    return this.adaptor.copy(source, destination, recursive);
  }

  async move(source: string, destination: string): Promise<void> {
    source = cleanPath(source);
    destination = cleanPath(destination);
    const sourceStat = await this.adaptor.stat(source);
    if (!sourceStat) throw new Error('Source not found.');
    return this.adaptor.move(source, destination);
  }

  async rename(source: string, destination: string): Promise<void> {
    this.move(source, destination);
  }

  async exists(path: string): Promise<boolean> {
    return !!(await this.stat(path));
  }

  async isDirectory(path: string): Promise<boolean> {
    path = cleanPath(path);
    return this.adaptor.isDirectory(path);
  }

  async isFile(path: string): Promise<boolean> {
    path = cleanPath(path);
    return this.adaptor.isFile(path);
  }

}


import { TypedEmitter } from 'tiny-typed-emitter';
import { FileStat, PathMap, PathDump } from './definitions';
import { BaseAdaptor, BaseAdaptorOptions } from './base';

import { FSAAdaptor, FSAAdaptorOptions } from './adaptors/fsa-api';
import { IndexedDBAdaptor, IndexedDBAdaptorOptions } from './adaptors/indexed-db';
import { MemoryAdaptor, MemoryAdaptorOptions } from './adaptors/memory';

export { FileStat, PathMap, PathDump };

export enum FilesMultitoolType {
  FSA_API = 'fsa-api',
  INDEXEDDB = 'indexed-db',
  MEMORY = 'memory',
}

/**
 * An interface representing a user-friendly list item for an adaptor type.
 * @interface
 * @property {string} text - The pretty text representation of the adaptor type.
 * @property {string} technology - The technology associated with the adaptor type.
 * @property {FilesMultitoolType} value - The actual FilesMultitoolType value.
 */
export interface FilesMultitoolPrettyTypes {
  text: string;
  technology: string;
  value: FilesMultitoolType;
}

/**
 * An event object that is emitted when a file or directory is added, deleted, modified, or renamed.
 * @interface
 * @property {string} path - The path of the file or directory.
 * @property {FileStat} stat - The new stats of the file or directory.
 * @property {string} [oldPath] - The old path of the file or directory if it was renamed.
 * @property {FileStat} [oldStat] - The old stats of the file or directory if it was renamed.
 * @property {'added' | 'deleted' | 'modified' | 'renamed'} action - The action that occurred.
 */
export interface FilesMultitoolChangeEvent {
  path: string;
  stat: FileStat;
  oldPath?: string;
  oldStat?: FileStat;
  action: 'added' | 'deleted' | 'modified' | 'renamed';
}

/**
 * An object representing the events that can be emitted by the FilesMultitool class.
 */
interface FilesMultitoolEvents {
  'file-added': (path: string) => void;
  'file-deleted': (path: string) => void;
  'file-changed': (path: string, change: FilesMultitoolChangeEvent) => void;
  'file-renamed': (newPath: string, oldPath: string) => void;
  'directory-added': (path: string) => void;
  'directory-deleted': (path: string) => void;
  'directory-changed': (path: string, change: FilesMultitoolChangeEvent) => void;
  'directory-renamed': (newPath: string, oldPath: string) => void;
  'paths-changed': (paths: string[], changes: FilesMultitoolChangeEvent[]) => void;
}

export interface FilesMultitoolOptions extends BaseAdaptorOptions, FSAAdaptorOptions, IndexedDBAdaptorOptions, MemoryAdaptorOptions {
}


const cleanPath = (path: string) => {
  if (!path) return '';
  if (path.includes('..')) throw new Error('Invalid path.');
  return path
    .replace(/\/+/g, '/')
    .replace(/(^\/)|(\/$)/g, '');
};

export default class FilesMultitool extends TypedEmitter<FilesMultitoolEvents>{
  type: FilesMultitoolType;
  ref: string;
  options: BaseAdaptorOptions;
  adaptor: BaseAdaptor;

  /**
   * Creates a new instance of FilesMultitool with the specified type, reference, and options.
   * @param type The type of adaptor to use.
   * @param ref The reference for the adaptor.
   * @param options The options for the adaptor.
   * @throws An error if the reference is not provided or if the adaptor type is not supported.
   */
  constructor(type: FilesMultitoolType, ref: string, options: FilesMultitoolOptions = {}) {
    if (!ref) throw new Error('Reference is required.');
    super();
    this.type = type;
    this.ref = ref;
    this.options = options;

    switch (type) {
      case FilesMultitoolType.FSA_API:
        this.adaptor = new FSAAdaptor(ref, options as FSAAdaptorOptions);
        break;
      case FilesMultitoolType.INDEXEDDB:
        this.adaptor = new IndexedDBAdaptor(ref, options as IndexedDBAdaptorOptions);
        break;
      case FilesMultitoolType.MEMORY:
        this.adaptor = new MemoryAdaptor(ref, options as MemoryAdaptorOptions);
        break;
      default:
        throw new Error('Unsupported adaptor type.');
    }

    this.on('file-changed', (path, change) => {
      switch (change.action) {
        case 'added':
          this.emit('file-added', path);
          break;
        case 'deleted':
          this.emit('file-deleted', path);
          break;
        case 'renamed':
          this.emit('file-renamed', path, change.oldPath!);
          break;
        default:
          break;
      }
    });

    this.on('directory-changed', (path, change) => {
      switch (change.action) {
        case 'added':
          this.emit('directory-added', path);
          break;
        case 'deleted':
          this.emit('directory-deleted', path);
          break;
        case 'renamed':
          this.emit('directory-renamed', path, change.oldPath!);
          break;
        default:
          break;
      }
    });
  }

  /**
   * Checks if the specified adaptor type is supported.
   * @param type The adaptor type to check.
   * @returns True if the adaptor type is supported, false otherwise.
   */
  static isSupported(type: FilesMultitoolType): boolean {
    switch (type) {
      case FilesMultitoolType.FSA_API:
        return FSAAdaptor.isSupported();
      case FilesMultitoolType.INDEXEDDB:
        return IndexedDBAdaptor.isSupported();
      case FilesMultitoolType.MEMORY:
        return MemoryAdaptor.isSupported();
      default:
        return false;
    }
  }

  /**
   * Gets a list of supported adaptor types.
   * @param includeMemory Whether or not to include the memory adaptor type. Defaults to false.
   * @returns A list of supported adaptor types.
   * @see FilesMultitool.isSupported
   * @see FilesMultitoolPrettyTypes
   */
  static getTypes(includeMemory?: boolean): FilesMultitoolPrettyTypes[] {
    return [
      {
        technology: 'File System Access API',
        text: 'Computer File System',
        value: FilesMultitoolType.FSA_API,
      },
      {
        technology: 'IndexedDB',
        text: 'Local Browser Storage',
        value: FilesMultitoolType.INDEXEDDB,
      },
      ...(includeMemory ? [{
        technology: 'Memory',
        text: 'In-Memory Storage - Not Persistent (for testing only)',
        value: FilesMultitoolType.MEMORY,
      }] : []),
    ].filter(type => FilesMultitool.isSupported(type.value));
  }

  /**
   * Initializes the adaptor. This must be called before any other methods are called.
   * e.g. this will request permission to use the File System Access API.
   * @returns {Promise<void>}
   */
  async init(): Promise<void> {
    await this.adaptor.init();
  }

  /**
   * Destroys the adaptor. This should be called when the adaptor is no longer needed.
   * It won't delete the files, just the connection to the file system/database.
   * e.g. this will revoke permission to use the File System Access API.
   * @returns {Promise<void>}
   */
  async destroy(): Promise<void> {
    await this.adaptor.destroy();
  }

  /**
   * Checks if the adaptor is initialized.
   * @returns {boolean} true if initialized, false otherwise.
   * @see FilesMultitool.init
   */
  get isInitialized(): boolean {
    return !!this.adaptor?.isInitialized;
  }

  /**
   * Gets the details of a file or directory.
   * @param path The path of the file or directory.
   * @returns {Promise<FileStat | null>} The details of the file or directory, or null if not found.
   */
  async stat(path: string): Promise<FileStat | null> {
    path = cleanPath(path);
    return this.adaptor.stat(path);
  }

  /**
   * Lists the files in a directory.
   * @param path The path of the directory.
   * @param recursive Whether to list files recursively.
   * @returns {Promise<PathMap>} The map of files/directories and their respective FileStat details.
   * @see PathMap
   * @see FileStat
   */
  async list(path: string, recursive?: boolean): Promise<PathMap> {
    path = cleanPath(path);
    const map = {} as PathMap;
    const root = await this.adaptor.list(path);
    for (const [key, value] of Object.entries(root)) {
      if (key === path) continue;
      map[key] = value;
      if (value.isDirectory && recursive) {
        const children = await this.list(value.path, recursive);
        Object.assign(map, children);
      }
    }
    return map;
  }

  /**
   * Reads a files content as a string using the specified encoding.
   * @param path The path of the file.
   * @param encoding The encoding to use.
   * @returns {Promise<string>} The file content as a string.
   * @throws An error if the file is not found or if the path is a directory.
   * @see https://nodejs.org/api/buffer.html#buffer_buffers_and_character_encodings
   */
  async readFile(path: string, encoding: BufferEncoding = 'utf-8'): Promise<string> {
    path = cleanPath(path);
    const stat = await this.adaptor.stat(path);
    if (!stat) throw new Error('File not found.');
    if (stat.isDirectory) throw new Error('Cannot read a directory.');
    const buffer = await this.adaptor.readFile(path);
    return buffer.toString(encoding);
  }

  /**
   * Writes content to a file at the specified path. If the file already exists, it will be overwritten.
   * @param path - The path to the file to write to.
   * @param content - The content to write to the file.
   * @param encoding - The encoding to use when writing the file. Defaults to 'utf-8'.
   * @returns {Promise<void>} A Promise that resolves when the file has been written.
   * @throws An error if the specified path is a directory.
   * @emits {FilesMultitoolEvents#file-added} When a file is added.
   * @emits {FilesMultitoolEvents#file-changed} When a file is added or modified.
   * @emits {FilesMultitoolEvents#paths-changed} When a file is added or modified.
   */
  async writeFile(path: string, content: Buffer | ArrayBuffer): Promise<void>
  async writeFile(path: string, content: string, encoding?: BufferEncoding): Promise<void>
  async writeFile(path: string, content: string | Buffer | ArrayBuffer, encoding: BufferEncoding = 'utf-8'): Promise<void> {
    path = cleanPath(path);
    let stat = await this.adaptor.stat(path);
    if (stat?.isDirectory) throw new Error('Cannot write to a directory.');
    const parentPath = path.split('/').slice(0, -1).join('/').replace(/(^\/)|(\/$)/g, '');
    if (parentPath) await this.adaptor.mkdir(parentPath);
    if (typeof content === 'string') {
      content = Buffer.from(content, encoding);
    }
    if (content instanceof ArrayBuffer) {
      content = Buffer.from(content);
    }
    await this.adaptor.writeFile(path, content as Buffer);
    const change = {
      path,
      stat: stat || (await this.adaptor.stat(path)),
      action: stat ? 'modified' : 'added',
    } as FilesMultitoolChangeEvent;
    this.emit('file-changed', path, change);
    this.emit('paths-changed', [path], [change]);
  }

  /**
   * Deletes a file at the specified path.
   * @param path - The path of the file to delete.
   * @returns {Promise<void>} A Promise that resolves when the file has been deleted.
   * @throws An error if the file is not found or if it is a directory.
   * @emits {FilesMultitoolEvents#file-deleted} When a file is deleted.
   * @emits {FilesMultitoolEvents#file-changed} When a file is deleted.
   * @emits {FilesMultitoolEvents#paths-changed} When a file is deleted.
   */
  async deleteFile(path: string): Promise<void> {
    path = cleanPath(path);
    const stat = await this.adaptor.stat(path);
    if (!stat) throw new Error('File not found.');
    if (stat.isDirectory) throw new Error('Cannot delete a directory.');
    await this.adaptor.deleteFile(path);
    const change = {
      path,
      stat,
      action: 'deleted',
    } as FilesMultitoolChangeEvent;
    this.emit('file-changed', path, change);
    this.emit('paths-changed', [path], [change]);
  }

  /**
   * Removes a file at the specified path. Alias for deleteFile.
   * @param path - The path of the file to remove.
   * @returns {Promise<void>} A Promise that resolves when the file is successfully removed.
   * @throws An error if the file is not found or if it is a directory.
   * @see FilesMultitool.deleteFile
   */
  async rm(path: string): Promise<void> {
    return this.deleteFile(path);
  }

  /**
   * Creates a new directory at the specified path.
   * @param path - The path where the directory should be created.
   * @returns {Promise<void>} A Promise that resolves when the directory is created.
   * @throws An error if the directory already exists.
   * @emits {FilesMultitoolEvents#directory-added} When a directory is added.
   * @emits {FilesMultitoolEvents#directory-changed} When a directory is added.
   * @emits {FilesMultitoolEvents#paths-changed} When a directory is added.
   */
  async mkdir(path: string): Promise<void> {
    path = cleanPath(path);
    const stat = await this.adaptor.stat(path);
    if (stat) throw new Error('Directory already exists.');
    await this.adaptor.mkdir(path);
    const change = {
      path,
      stat: await this.adaptor.stat(path),
      action: 'added',
    } as FilesMultitoolChangeEvent;
    this.emit('directory-changed', path, change);
    this.emit('paths-changed', [path], [change]);
  }

  /**
   * Emits events for changes made to a file or directory and its children.
   * @param action - The type of change that occurred ('added', 'deleted', or 'renamed').
   * @param path - The path of the file or directory that was changed.
   * @param pathStat - The new stats of the file or directory that was changed.
   * @param pathMap - A map of child paths to their stats for the directory that was changed.
   * @param oldPath - The old path of the file or directory if it was renamed.
   * @param oldStat - The old stats of the file or directory if it was renamed.
   * @param oldPathMap - A map of child paths to their old stats for the directory if it was renamed.
   */
  _massEmit(
    action: 'added' | 'deleted' | 'renamed',
    path: string,
    pathStat: FileStat,
    pathMap?: PathMap,
    oldPath?: string,
    oldStat?: FileStat,
    oldPathMap?: PathMap,
  ) {
    const rootChange = {
      path,
      stat: pathStat,
      ...(action === 'renamed' ? {
        oldPath,
        oldStat,
      } : {}),
      action,
    } as FilesMultitoolChangeEvent;
    if (!pathStat.isDirectory) {
      this.emit('file-changed', path, rootChange);
      this.emit('paths-changed', [path], [rootChange]);
      return;
    }
    if (!pathMap) return;
    const oldPaths = oldPath ? [oldPath, ...Object.keys(oldPathMap || {})] : [];
    const getOldPath = (newPath: string) => {
      const res = newPath.replace(path, oldPath || '');
      return oldPaths.includes(res) ? res : null;
    };
    const changes = Object.keys(pathMap).map(childPath => {
      const change = {
        path: childPath,
        stat: pathMap[childPath],
        ...(action === 'renamed' ? {
          oldPath: getOldPath(childPath),
          oldStat: oldPathMap![getOldPath(childPath) || ''],
        } : {}),
        action,
      } as FilesMultitoolChangeEvent;
      if (change.stat.isDirectory) {
        this.emit('directory-changed', childPath, change);
      } else {
        this.emit('file-changed', childPath, change);
      }
      return change;
    });
    this.emit('directory-changed', path, rootChange);
    const paths = [path, ...Object.keys(pathMap)];
    this.emit('paths-changed', paths, [rootChange, ...changes]);
  }

  /**
   * Removes a directory at the specified path.
   * @param path - The path of the directory to remove.
   * @param recursive - Whether or not to remove the directory and its contents recursively.
   * @returns {Promise<void>} A Promise that resolves when the directory is successfully removed.
   * @throws An error if the directory is not found, is not a directory, or is not empty when `recursive` is false.
   * @emits {FilesMultitoolEvents#directory-deleted} When a directory is deleted.
   * @emits {FilesMultitoolEvents#directory-changed} When a directory is deleted.
   * @emits {FilesMultitoolEvents#file-deleted} When a file is deleted.
   * @emits {FilesMultitoolEvents#file-changed} When a file is deleted.
   * @emits {FilesMultitoolEvents#paths-changed} When a file or directory is deleted.
   */
  async rmdir(path: string, recursive?: boolean): Promise<void> {
    path = cleanPath(path);
    const stat = await this.adaptor.stat(path);
    if (!stat) throw new Error('Directory not found.');
    if (!stat.isDirectory) throw new Error('Cannot delete a file.');
    const children = await this.list(path, recursive);
    if (Object.keys(children).length && !recursive) throw new Error('Directory is not empty.');
    await this.adaptor.rmdir(path);
    this._massEmit('deleted', path, stat, children);
  }

  /**
   * Copies a file or directory from the source path to the destination path.
   * @param source - The path of the file or directory to copy.
   * @param destination - The path to copy the file or directory to.
   * @param recursive - Optional. If true, copies the directory and its contents recursively. Defaults to false.
   * @returns {Promise<void>} A Promise that resolves when the file or directory has been copied.
   * @throws An error if the source path is not found.
   * @emits {FilesMultitoolEvents#file-added} When a file is added.
   * @emits {FilesMultitoolEvents#file-changed} When a file is added.
   * @emits {FilesMultitoolEvents#directory-added} When a directory is added.
   * @emits {FilesMultitoolEvents#directory-changed} When a directory is added.
   * @emits {FilesMultitoolEvents#paths-changed} When everything is copied.
   */
  async copy(source: string, destination: string, recursive?: boolean): Promise<void> {
    source = cleanPath(source);
    destination = cleanPath(destination);
    const sourceStat = await this.adaptor.stat(source);
    if (!sourceStat) throw new Error('Source not found.');
    await this.adaptor.copy(source, destination, recursive);
    let children: PathMap = {};
    if (sourceStat.isDirectory) children = await this.list(destination, recursive);
    this._massEmit('added', destination, sourceStat, children);
  }

  /**
   * Moves a file or directory from the source path to the destination path.
   * @param source - The path of the file or directory to move.
   * @param destination - The path to move the file or directory to.
   * @returns {Promise<void>} A Promise that resolves when the file or directory has been moved.
   * @throws An error if the source file or directory is not found or if the destination already exists.
   * @emits {FilesMultitoolEvents#file-renamed} When a file is renamed.
   * @emits {FilesMultitoolEvents#file-changed} When a file is renamed.
   * @emits {FilesMultitoolEvents#directory-renamed} When a directory is renamed.
   * @emits {FilesMultitoolEvents#directory-changed} When a directory is renamed.
   * @emits {FilesMultitoolEvents#paths-changed} When everything is renamed.
   */
  async move(source: string, destination: string): Promise<void> {
    source = cleanPath(source);
    destination = cleanPath(destination);
    const sourceStat = await this.adaptor.stat(source);
    if (!sourceStat) throw new Error('Source not found.');
    let destinationStat = await this.adaptor.stat(destination);
    if (destinationStat) throw new Error('Destination already exists.');
    let sourceChildren: PathMap = {};
    if (sourceStat.isDirectory) sourceChildren = await this.list(source, true);
    await this.adaptor.move(source, destination);
    destinationStat = await this.adaptor.stat(destination);
    if (!destinationStat) throw new Error('Something went wrong. New destination was not found.');
    let destinationChildren: PathMap = {};
    if (sourceStat.isDirectory) destinationChildren = await this.list(destination, true);
    this._massEmit('renamed', destination, destinationStat, destinationChildren, source, sourceStat, sourceChildren);
  }

  /**
   * Renames a file or directory from the source path to the destination path. Alias for move.
   * @param source - The path of the file or directory to rename.
   * @param destination - The path to rename the file or directory to.
   * @returns {Promise<void>} A Promise that resolves when the file or directory has been renamed.
   * @throws An error if the source file or directory is not found or if the destination already exists.
   * @see FilesMultitool.move
   * @emits {FilesMultitoolEvents#file-renamed} When a file is renamed.
   * @emits {FilesMultitoolEvents#file-changed} When a file is renamed.
   * @emits {FilesMultitoolEvents#directory-renamed} When a directory is renamed.
   * @emits {FilesMultitoolEvents#directory-changed} When a directory is renamed.
   * @emits {FilesMultitoolEvents#paths-changed} When everything is renamed.
   */
  async rename(source: string, destination: string): Promise<void> {
    return this.move(source, destination);
  }

  /**
   * Checks if a file or directory exists at the specified path.
   * @param path - The path of the file or directory.
   * @returns {Promise<boolean>} true if the file or directory exists, false otherwise.
   * @see FilesMultitool.stat
   * @see FileStat
   */
  async exists(path: string): Promise<boolean> {
    return !!(await this.stat(path));
  }

  /**
   * Checks if a path is a directory.
   * @param path - The path of the file or directory.
   * @returns {Promise<boolean>} true if the path is a directory, false otherwise.
   */
  async isDirectory(path: string): Promise<boolean> {
    path = cleanPath(path);
    return this.adaptor.isDirectory(path);
  }

  /**
   * Checks if a path is a file.
   * @param path - The path of the file or directory.
   * @returns {Promise<boolean>} true if the path is a file, false otherwise.
   */
  async isFile(path: string): Promise<boolean> {
    path = cleanPath(path);
    return this.adaptor.isFile(path);
  }

  /**
   * Dumps the contents of the file system/database to a PathDump object.
   * @param getEncoding - A function that returns the encoding to use for a file.
   * @returns {Promise<PathDump>} The PathDump object. The keys are the paths and the values are the file contents.
   * @see PathDump
   */
  async dump(
    getEncoding: (path: string, stat: FileStat) => BufferEncoding = () => 'utf-8',
  ): Promise<PathDump> {
    const pathMap = await this.list('/', true);
    const dump = {} as PathDump;
    for (const [path, stat] of Object.entries(pathMap)) {
      if (stat.isDirectory) continue;
      const encoding = getEncoding(path, stat);
      dump[path] = await this.readFile(path, encoding);
    }
    return dump;
  }

}


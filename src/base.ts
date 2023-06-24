import { FileStat, PathMap } from './definitions';

const guessIfFolderPath = (path: string) => {
  const fileName = path.split('/').pop()!;
  return path.endsWith('/') || !fileName.includes('.');
}

// base adaptor class for different file systems strategies, e.g. indexedDB, file system access API, google drive, etc.
// generate as much as you can

export interface BaseAdaptorOptions {
  // options for the adaptor
  // optional fetch implementation (e.g. node-fetch, cross-fetch, etc.)
  fetch?: any;
}

export abstract class BaseAdaptor {
  protected ref: string;
  protected options: BaseAdaptorOptions;
  private _isInitialized: boolean = false;
  get isInitialized(): boolean {
    return this._isInitialized;
  }
  protected set isInitialized(value: boolean) {
    this._isInitialized = value;
  }

  /**
   * Check if the adaptor is supported in the current environment.
   * @returns {boolean} true if supported, false otherwise.
   */
  static isSupported(): boolean {
    return false;
  }

  // constructor()
  /**
   * Construct and initialize the adaptor.
   * @param {object} options - The options for the adaptor.
  */
  constructor(ref: string, options: BaseAdaptorOptions) {
    this.ref = ref;
    this.options = options;
  }

  // utility methods

  /**
   * Utility method to fetch a http resource.
   * @param {string} path - The path of the resource.
   * @param {object} options - The options for the fetch.
   * @returns {Promise<Response>} The response object.
   * @throws {Error} If no fetch implementation is found.
   * @throws {Error} If the fetch implementation throws an error.
   * @private
  */
  async #fetch(path: string, options: any): Promise<Response> {
    if (this.options.fetch) {
      return this.options.fetch(path, options);
    } else if (typeof fetch !== 'undefined') {
      return fetch(path, options);
    }
    throw new Error('No fetch implementation found.');
  }

  // abstract methods

  /**
   * Initialize the adaptor.
   * Could be used to create the database, or something else, or nothing.
   * @returns {Promise<void>}
  */
  async init(): Promise<void> {
    this.isInitialized = true;
  }

  /**
   * Destroy the adaptor.
   * Could be used to delete the database, or something else, or nothing.
   * This method should be called when the adaptor is no longer needed.
   * It wont delete the files, just the connection to the file system/database.
  */
  async destroy(): Promise<void> {
    this.isInitialized = false;
  }

  /**
   * stat a file or directory.
   * @param {string} path - The path of the file or directory.
   * @returns {Promise<FileStat | null>} The stat object, or null if not found.
  */
  abstract stat(path: string): Promise<FileStat | null>;

  /**
   * Read a file.
   * @param {string} path - The path of the file.
   * @returns {Promise<Buffer>} The file content.
  */
  abstract readFile(path: string): Promise<Buffer>;

  /**
   * Write a file.
   * @param {string} path - The path of the file.
   * @param {Buffer} data - The file content.
   * @returns {Promise<void>}
  */
  abstract writeFile(path: string, data: Buffer): Promise<void>;

  /**
   * Delete a file or directory.
   * @param {string} path - The path of the file or directory.
   * @returns {Promise<void>}
  */
  abstract deleteFile(path: string): Promise<void>;

  /**
   * List files in a directory.
   * @param {string} path - The path of the directory.
   * @returns {Promise<PathMap>} The list of files.
  */
  abstract list(path: string): Promise<PathMap>;

  /**
   * Create a directory.
   * @param {string} path - The path of the directory.
   * @returns {Promise<void>}
  */
  abstract mkdir(path: string): Promise<void>;

  /**
   * Remove a directory.
   * @param {string} path - The path of the directory.
   * @returns {Promise<void>}
  */
  abstract rmdir(path: string): Promise<void>;

  /**
   * copy a file.
   * @param {string} path - The path of the file.
   * @param {string} targetPath - The path to the folder where the file should be copied.
   * @param {string} newName - The new name of the file.
   * @returns {Promise<void>}
   * @private
  */
  abstract _copyFile(path: string, targetPath: string, newFileName?: string): Promise<void>;

  /**
   * copy a directory and its contents.
   * @param {string} path - The path of the directory.
   * @param {string} targetPath - The path to the folder where the directory's contents should be copied.
   * @param {boolean} recursive - If true, copy the contents recursively.
   * @returns {Promise<void>}
   * @private
  */
  abstract _copyDirectory(path: string, targetPath: string, recursive?: boolean): Promise<void>;


  // non-abstract methods, can be overridden if you want to optimize them

  /**
   * Copy a file or directory.
   * @param {string} path - The path of the file or directory.
   * @param {string} newPath - The new path of the file or directory.
   * @param {boolean} recursive - If true, copy the contents recursively.
   * @returns {Promise<void>}
  */
  async copy(path: string, newPath: string, recursive?: boolean): Promise<void> {
    const copyingToFolderPath = guessIfFolderPath(newPath);
    const sourceStat = await this.stat(path);
    const targetPath = copyingToFolderPath ? newPath : newPath.split('/').slice(0, -1).join('/');
    await this.mkdir(targetPath);

    if (sourceStat?.isDirectory) {
      if (!copyingToFolderPath) {
        throw new Error('Cannot copy a directory to a file.');
      }
      await this._copyDirectory(path, targetPath, recursive);
    }
    if (sourceStat?.isFile) {
      const newFileName = !copyingToFolderPath ? newPath.split('/').pop() : undefined;
      await this._copyFile(path, targetPath, newFileName);
    }
  }


  /**
   * Move a file or directory.
   * @param {string} path - The path of the file or directory.
   * @param {string} newPath - The new path of the file or directory.
   * @returns {Promise<void>}
  */
  async move(path: string, newPath: string): Promise<void> {
    const sourceStat = await this.stat(path);
    await this.copy(path, newPath, true);
    
    if (sourceStat?.isDirectory) {
      await this.rmdir(path);
    } else {
      await this.deleteFile(path);
    }
  }

  /**
   * Check if a path is a directory.
   * @param {string} path - The path of the file or directory.
   * @returns {Promise<boolean>} true if the path is a directory, false otherwise.
  */
  async isDirectory(path: string): Promise<boolean> {
    const stat = await this.stat(path);
    return !!stat?.isDirectory;
  }

  /**
   * Check if a path is a file.
   * @param {string} path - The path of the file or directory.
   * @returns {Promise<boolean>} true if the path is a file, false otherwise.
  */ 
  async isFile(path: string): Promise<boolean> {
    const stat = await this.stat(path);
    return !!stat?.isFile;
  }
}

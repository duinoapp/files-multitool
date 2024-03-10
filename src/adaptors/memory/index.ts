
import { BaseAdaptor, BaseAdaptorOptions } from '../../base';
import { FileStat, PathMap } from '../../definitions';

export interface MemoryAdaptorOptions extends BaseAdaptorOptions {}

interface MemoryFile extends FileStat {
  content?: string;
}

interface MemoryStore {
  [path: string]: MemoryFile;
}

export class MemoryAdaptor extends BaseAdaptor {
  private files: MemoryStore = {};

  static isSupported(): boolean {
    return true;
  }

  constructor(ref: string, options: BaseAdaptorOptions) {
    super(ref, options);
  }

  async init(): Promise<void> {
    return super.init();
  }

  async destroy(): Promise<void> {
    this.files = {};
    return super.destroy();
  }

  _toStat(file: MemoryFile): FileStat {
    const stat = {...file};
    delete stat.content;
    return stat;
  }

  async stat(path: string): Promise<FileStat | null> {
    const file = this.files[path];
    if (!file) {
      return null;
    }
    return this._toStat(file);
  }

  async readFile(path: string): Promise<Buffer> {
    const file = this.files[path];
    if (!file || file.isDirectory) {
      throw new Error(`File not found: ${path}`);
    }
    return Buffer.from(file.content || '', 'base64');
  }

  async writeFile(path: string, data: Buffer): Promise<void> {
    const file = this.files[path];
    this.files[path] = {
      path,
      parentPath: path.split('/').slice(0, -1).join('/')
        .replace(/(^\/)|(\/$)/g, ''),
      isDirectory: false,
      isFile: true,
      size: data.length,
      modifiedTime: new Date(),
      createdTime: file?.createdTime || new Date(),
      content: data.toString('base64'),
    };
  }

  async deleteFile(path: string): Promise<void> {
    delete this.files[path];
  }

  async list(path: string): Promise<PathMap> {
    const files: PathMap = {};
    for (const filePath in this.files) {
      if (filePath.startsWith(path + '/')) {
        const relativePath = filePath.slice(path.length + 1);
        const parts = relativePath.split('/');
        if (parts.length === 1) {
          files[parts[0]] = this._toStat(this.files[filePath]);
        } else {
          const dirName = parts[0];
          if (!files[dirName]) {
            files[dirName] = this._toStat(this.files[`${path}/${dirName}`]);
          }
        }
      }
    }
    return files;
  }

  async mkdir(path: string): Promise<void> {
    const parts = path.replace(/(^\/)|(\/$)/g, '').split('/');
    for (let i = 0; i < parts.length; i++) {
      const partPath = parts.slice(0, i + 1).join('/');
      if (!this.files[partPath]) {
        this.files[partPath] = {
          path: partPath,
          parentPath: partPath.split('/').slice(0, -1).join('/')
            .replace(/(^\/)|(\/$)/g, ''),
          isDirectory: true,
          isFile: false,
          size: 0,
          modifiedTime: new Date(),
          createdTime: new Date(),
        };
      }
    }
  }

  async rmdir(path: string): Promise<void> {
    for (const filePath in this.files) {
      if (filePath.startsWith(path + '/')) {
        delete this.files[filePath];
      }
    }
    delete this.files[path];
  }

  async _copyFile(path: string, targetPath: string, newFileName?: string): Promise<void> {
    const file = this.files[path];
    if (!file || file.isDirectory) {
      throw new Error(`File not found: ${path}`);
    }
    const targetFilePath = newFileName ? `${targetPath}/${newFileName}` : `${targetPath}/${path.split('/').pop()}`;
    this.files[targetFilePath] = {
      ...file,
      path: targetFilePath,
      parentPath: targetPath,
      modifiedTime: new Date(),
      createdTime: new Date(),
    };
  }

  async _copyDirectory(path: string, targetPath: string, recursive?: boolean): Promise<void> {
    const files = await this.list(path);
    for (const fileName in files) {
      const filePath = `${path}/${fileName}`;
      const targetFilePath = `${targetPath}/${fileName}`;
      if (files[fileName].isDirectory) {
        await this.mkdir(targetFilePath);
        if (recursive) {
          await this._copyDirectory(filePath, targetFilePath, true);
        }
      } else {
        await this._copyFile(filePath, targetPath);
      }
    }
  }
}
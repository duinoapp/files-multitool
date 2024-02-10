
import '@types/wicg-file-system-access'

export interface FileStat {
  path: string;
  parentPath: string;
  isDirectory: boolean;
  isFile: boolean;
  size: number;
  modifiedTime?: Date;
  createdTime?: Date;
}


export interface PathMap {
  [path: string]: FileStat;
}

export interface PathDump {
  [path: string]: string;
}
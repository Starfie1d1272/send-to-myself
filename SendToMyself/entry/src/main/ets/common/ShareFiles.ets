import { common } from '@kit.AbilityKit';
import { fileIo, fileUri } from '@kit.CoreFileKit';
import { uniformTypeDescriptor } from '@kit.ArkData';
import { util } from '@kit.ArkTS';

export interface SharedFileData { path: string; filename: string; mimeType: string }
export class SharedFile implements SharedFileData {
  path: string;
  filename: string;
  mimeType: string;
  constructor(path: string, filename: string, mimeType: string) {
    this.path = path;
    this.filename = filename;
    this.mimeType = mimeType;
  }
}

export function legacyFile(path: string): SharedFileData {
  let filename = path.substring(path.lastIndexOf('/') + 1);
  return new SharedFile(path, filename, mimeForFile(filename));
}
function mimeForFile(filename: string, utd?: string): string {
  try {
    let extension = filename.substring(filename.lastIndexOf('.'));
    let type = uniformTypeDescriptor.getUniformDataTypeByFilenameExtension(extension);
    let descriptor = uniformTypeDescriptor.getTypeDescriptor(type);
    let mime = descriptor.mimeTypes.find((value: string) => value.indexOf('*') < 0);
    if (mime) return mime;
  } catch (_err) {}
  if (utd) {
    try {
      let descriptor = uniformTypeDescriptor.getTypeDescriptor(utd);
      let mime = descriptor.mimeTypes.find((value: string) => value.indexOf('*') < 0);
      if (mime) return mime;
    } catch (_err) {}
  }
  return 'application/octet-stream';
}

export function copySharedFile(context: common.Context, uri: string, title?: string, utd?: string): SharedFileData {
  let filename = title ?? '';
  try { filename = new fileUri.FileUri(uri).name || filename; } catch (_err) {}
  filename = filename.replace(/[\\/\u0000-\u001f]/g, '_').substring(0, 200) || 'shared-file';
  let directory = context.filesDir + '/shared-queue';
  if (!fileIo.accessSync(directory)) fileIo.mkdirSync(directory, true);
  let path = directory + '/' + util.generateRandomUUID();
  let source = fileIo.openSync(uri, fileIo.OpenMode.READ_ONLY);
  try {
    let destination = fileIo.openSync(path, fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE);
    try { fileIo.copyFileSync(source.fd, destination.fd); }
    catch (error) { try { fileIo.unlinkSync(path); } catch (_err) {} throw error; }
    finally { fileIo.closeSync(destination); }
  } finally { fileIo.closeSync(source); }
  return new SharedFile(path, filename, mimeForFile(filename, utd));
}

export function cleanSharedFiles(files: SharedFileData[]): void {
  for (let i = 0; i < files.length; i++) {
    try { fileIo.unlinkSync(files[i].path); } catch (_err) {}
  }
}

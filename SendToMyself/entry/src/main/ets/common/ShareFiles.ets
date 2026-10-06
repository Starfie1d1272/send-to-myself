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

function sniffMime(path: string): string | undefined {
  let file = fileIo.openSync(path, fileIo.OpenMode.READ_ONLY);
  try {
    let buffer = new ArrayBuffer(16);
    let length = fileIo.readSync(file.fd, buffer);
    let bytes = new Uint8Array(buffer);
    if (length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return 'image/png';
    if (length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
    if (length >= 6 && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 56) return 'image/gif';
    if (length >= 12 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 &&
      bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) return 'image/webp';
  } finally { fileIo.closeSync(file); }
  return undefined;
}

export function copySharedFile(context: common.Context, uri: string, title?: string, utd?: string): SharedFileData {
  let filename = title ?? '';
  try {
    let uriName = new fileUri.FileUri(uri).name;
    if (!filename || uriName.indexOf('.') >= 0) filename = uriName || filename;
  } catch (_err) {}
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
  try { return new SharedFile(path, filename, sniffMime(path) ?? mimeForFile(filename, utd)); }
  catch (error) { try { fileIo.unlinkSync(path); } catch (_err) {} throw error; }
}

export function cleanSharedFiles(files: SharedFileData[]): void {
  for (let i = 0; i < files.length; i++) {
    try { fileIo.unlinkSync(files[i].path); } catch (_err) {}
  }
}

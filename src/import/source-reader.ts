import { readFile, stat } from 'node:fs/promises';

export async function readBinarySource(source: string) {
  if (isHttpSource(source)) {
    const response = await fetch(source);

    if (!response.ok) {
      throw new Error(`Failed to download source: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  return readFile(source);
}

export async function readTextSource(source: string) {
  if (isHttpSource(source)) {
    const response = await fetch(source);

    if (!response.ok) {
      throw new Error(`Failed to download source: ${response.status} ${response.statusText}`);
    }

    return response.text();
  }

  return readFile(source, 'utf8');
}

export async function getSourceUpdatedAt(source: string) {
  if (!isHttpSource(source)) {
    const fileStat = await stat(source);
    return fileStat.mtime;
  }

  try {
    const response = await fetch(source, {
      method: 'HEAD'
    });
    const lastModified = response.headers.get('last-modified');

    if (response.ok && lastModified) {
      const parsed = new Date(lastModified);

      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  } catch {
    return new Date();
  }

  return new Date();
}

export function isHttpSource(source: string) {
  return /^https?:\/\//i.test(source);
}

import { realpathSync } from 'fs';
import { basename, dirname, isAbsolute, relative, resolve as resolvePath } from 'path';

export function pathParts(pathname: string): string[] {
  return String(pathname || '/').split('/');
}

export function teamNameFromPath(pathname: string): string {
  return decodeURIComponent(pathParts(pathname)[2] || '');
}

export function taskIdFromTeamTaskPath(pathname: string): string {
  return decodeURIComponent(pathParts(pathname)[4] || '');
}

export function actionIdFromPath(pathname: string): string {
  return decodeURIComponent(pathParts(pathname)[2] || '');
}

export function lastPathSegment(pathname: string): string {
  const parts = pathParts(pathname);
  return decodeURIComponent(parts[parts.length - 1] || '');
}

function resolvePathForContainment(
  inputPath: string,
  pathResolve: (input: string) => string,
  pathRealpath: (input: string) => string,
): string {
  const resolved = pathResolve(inputPath);
  try {
    return pathRealpath(resolved);
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
    let probe = resolved;
    const missingSegments: string[] = [];
    while (true) {
      const parent = dirname(probe);
      if (parent === probe) throw err;
      missingSegments.unshift(basename(probe));
      probe = parent;
      try {
        const realParent = pathRealpath(probe);
        return resolvePath(realParent, ...missingSegments);
      } catch (parentErr: any) {
        if (parentErr?.code !== 'ENOENT') throw parentErr;
      }
    }
  }
}

export function isPathWithin(
  basePath: string,
  candidatePath: string,
  pathResolve: (input: string) => string = resolvePath,
  pathRealpath: (input: string) => string = realpathSync.native || realpathSync,
): boolean {
  try {
    const baseReal = pathRealpath(pathResolve(basePath));
    const candidateReal = resolvePathForContainment(candidatePath, pathResolve, pathRealpath);
    const rel = relative(baseReal, candidateReal);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  } catch {
    return false;
  }
}

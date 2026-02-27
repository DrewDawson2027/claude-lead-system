import { isAbsolute, relative } from 'path';

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

export function isPathWithin(basePath: string, candidatePath: string, pathResolve: (input: string) => string): boolean {
  const baseResolved = pathResolve(basePath);
  const candidateResolved = pathResolve(candidatePath);
  const rel = relative(baseResolved, candidateResolved);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

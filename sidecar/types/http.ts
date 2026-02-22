export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

export interface RequestContext {
  method: HttpMethod;
  pathname: string;
  originalPathname: string;
  apiVersion: 'v1';
  isLegacyAlias: boolean;
  canonicalPath: string;
}

export interface HttpErrorPayload {
  error: string;
  code?: string;
  details?: unknown;
}

export interface JsonResponse<T = unknown> {
  status: number;
  body: T;
  headers?: Record<string, string>;
}

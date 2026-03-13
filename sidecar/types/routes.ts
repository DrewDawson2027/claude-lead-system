import type { RequestContext } from "./http.js";

export interface RouteDefinition<TBody = unknown> {
  method: RequestContext["method"];
  path: string;
  description?: string;
  handlerName?: string;
  bodySchemaName?: string;
  _body?: TBody;
}

export interface ValidationResult<T> {
  ok: true;
  value: T;
}

export interface ValidationFailure {
  ok: false;
  status: number;
  error: string;
}

export type Validation<T> = ValidationResult<T> | ValidationFailure;

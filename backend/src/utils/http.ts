import type { Response } from 'express';

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
}

/** Success envelope: `{ data }` (and `meta` for paginated lists). */
export function ok<T>(res: Response, data: T, meta?: PageMeta | Record<string, unknown>): Response {
  return res.status(200).json(meta ? { data, meta } : { data });
}

export function created<T>(res: Response, data: T): Response {
  return res.status(201).json({ data });
}

export function noContent(res: Response): Response {
  return res.status(204).end();
}

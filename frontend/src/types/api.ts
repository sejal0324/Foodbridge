/** Response envelopes used by every backend endpoint. */
export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  /** Present on GET /notifications. */
  unread?: number;
}

export interface ApiEnvelope<T> {
  data: T;
  meta?: PageMeta;
}

export interface Paginated<T> {
  items: T[];
  meta: PageMeta;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

/** REAL = only real records; MIXED/SYNTHETIC = includes demo or synthetic data. */
export type DataLabel = 'REAL' | 'MIXED' | 'SYNTHETIC';

export interface LatLng {
  lat: number;
  lng: number;
}

export type DistanceSource = 'STRAIGHT_LINE_ESTIMATE' | 'ROAD_GOOGLE_ROUTES';

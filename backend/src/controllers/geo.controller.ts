import type { Request, Response } from 'express';
import { z } from 'zod';
import { GeocodingUnavailableError, type GeocodingClient } from '../integrations/geocoding.js';
import { INDIAN_STATES_AND_UTS, isInIndia } from '../utils/india.js';
import { AppError, unprocessable } from '../utils/errors.js';
import { ok } from '../utils/http.js';
import { parseQuery } from '../validators/common.js';

/** India-wide location search for address entry (Google when configured, otherwise OpenStreetMap). */
export function geoController(geo: GeocodingClient) {
  const unavailable = (err: unknown) => {
    if (err instanceof GeocodingUnavailableError) throw new AppError(503, 'GEOCODING_UNAVAILABLE', 'Location search is temporarily unavailable. You can still pick the location on the map.');
    throw err;
  };
  return {
    async search(req: Request, res: Response) {
      const { q } = parseQuery(z.object({ q: z.string().trim().min(3).max(200) }), req);
      res.setHeader('Cache-Control', 'private, max-age=300');
      return ok(res, await geo.search(q).catch(unavailable));
    },
    async reverse(req: Request, res: Response) {
      const { lat, lng } = parseQuery(z.object({ lat: z.coerce.number(), lng: z.coerce.number() }), req);
      if (!isInIndia({ lat, lng })) throw unprocessable('FoodBridge currently operates only within India.', 'LOCATION_OUTSIDE_INDIA');
      return ok(res, await geo.reverse(lat, lng).catch(unavailable));
    },
    states(_req: Request, res: Response) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return ok(res, INDIAN_STATES_AND_UTS);
    },
  };
}

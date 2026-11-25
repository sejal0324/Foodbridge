/**
 * Browser configuration. Only VITE_* variables reach the bundle; never put
 * secrets in them. In development the Vite proxy serves /api and /socket.io
 * from the same origin as the app.
 */
const env = import.meta.env;

export const API_BASE_URL: string = (env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || '/api';

/** Socket.IO origin. Empty string = same origin as the page (through the dev proxy). */
export const SOCKET_URL: string = (env.VITE_SOCKET_URL as string | undefined) || '';

/** When set, maps render with Google Maps JS; otherwise OpenStreetMap via Leaflet. */
export const GOOGLE_MAPS_BROWSER_API_KEY: string = (env.VITE_GOOGLE_MAPS_BROWSER_API_KEY as string | undefined) ?? '';

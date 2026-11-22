/** Canonical public API version. Unversioned paths are not served. */
export const API_VERSION = 'v1';
export const API_VERSION_PREFIX = `/api/${API_VERSION}`;

/** Internal route templates used for metrics and rate-limit grouping. */
export const LEGACY_API_TEMPLATE = '/api/legacy';
export const UNMATCHED_API_TEMPLATE = '/api/other';

const API_VERSION = 'v1';
const API_PREFIX = `/${API_VERSION}`;

function isVersionedPath(pathname) {
  return pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`);
}

export function normalizeApiPath(pathname) {
  const raw = String(pathname || '/');
  if (raw === API_PREFIX) {
    return {
      apiVersion: API_VERSION,
      isVersioned: true,
      isLegacyAlias: false,
      originalPath: raw,
      routePath: '/',
      canonicalPath: API_PREFIX,
    };
  }
  if (isVersionedPath(raw)) {
    const routePath = raw.slice(API_PREFIX.length) || '/';
    return {
      apiVersion: API_VERSION,
      isVersioned: true,
      isLegacyAlias: false,
      originalPath: raw,
      routePath,
      canonicalPath: raw,
    };
  }
  const routePath = raw || '/';
  const canonicalPath = routePath === '/' ? API_PREFIX : `${API_PREFIX}${routePath}`;
  return {
    apiVersion: API_VERSION,
    isVersioned: false,
    isLegacyAlias: true,
    originalPath: raw,
    routePath,
    canonicalPath,
  };
}

export function legacyDeprecationHeaders(routeMeta, now = new Date()) {
  if (!routeMeta?.isLegacyAlias) return {};
  const sunsetMs = Number(process.env.LEAD_SIDECAR_LEGACY_SUNSET_MS || 90 * 24 * 60 * 60 * 1000);
  const sunsetDate = new Date(now.getTime() + sunsetMs).toUTCString();
  return {
    Deprecation: 'true',
    Sunset: sunsetDate,
    Link: `<${routeMeta.canonicalPath}>; rel="successor-version"`,
  };
}

export function attachRouteMeta(req, routeMeta) {
  // Annotate request so response helpers can add deprecation headers centrally.
  req.__sidecarRouteMeta = routeMeta;
}

export function getRouteMeta(req) {
  return req?.__sidecarRouteMeta || null;
}

export function currentApiVersion() {
  return API_VERSION;
}

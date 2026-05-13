/**
 * Resolves an avatar URL from the persona config.
 *
 * - Ready Player Me: in **dev**, defaults to same-origin `/__rpm/<id>.glb` (Vite proxies to models.readyplayer.me)
 *   so the browser never has to resolve that host. In **production**, uses `VITE_HTTP_SERVER_URL` `/assets/rpm/`
 *   unless `VITE_RPM_USE_PROXY=false` (then direct HTTPS to RPM).
 * - Local `/avatars/*.glb` paths are returned as-is.
 * - `VITE_DEFAULT_AVATAR_GLB` swaps the demo RPM fallback.
 */
// Public RPM sample avatar (docs) — guaranteed to exist and can be requested with morphTargets.
// If you have your own RPM avatar, set `VITE_DEFAULT_AVATAR_GLB` to it.
const DEMO_RPM =
  import.meta.env.VITE_DEFAULT_AVATAR_GLB ??
  "https://models.readyplayer.me/6185a4acfb622cf1cdc49348.glb";

const VISEME_QUERY = "morphTargets=ARKit,Oculus%20Visemes";
// Maximum-compatibility settings: disable optional mesh compression that requires extra decoders.
// (RPM may enable meshopt when requesting morph targets; forcing false avoids loader issues.)
const RPM_COMPAT_QUERY = "useMeshOptCompression=false&useDracoMeshCompression=false";

export function ensureRpmQuery(url: string): string {
  const hasVisemes = url.includes("morphTargets=");
  const hasCompat =
    /(?:^|[?&])useMeshOptCompression=/i.test(url) || /(?:^|[?&])useDracoMeshCompression=/i.test(url);

  const parts: string[] = [];
  if (!hasVisemes) parts.push(VISEME_QUERY);
  if (!hasCompat) parts.push(RPM_COMPAT_QUERY);
  if (!parts.length) return url;
  return url.includes("?") ? `${url}&${parts.join("&")}` : `${url}?${parts.join("&")}`;
}

function toLocalRpmProxy(url: string): string {
  // If you deploy the server elsewhere, set VITE_HTTP_SERVER_URL accordingly.
  const serverBase = (import.meta.env.VITE_HTTP_SERVER_URL as string | undefined) ?? "http://localhost:3001";
  try {
    const u = new URL(url);
    const m = /^\/([a-zA-Z0-9]+)\.glb$/.exec(u.pathname);
    if (!m) return url;
    const id = m[1];
    // Preserve query string (already includes morphTargets + compat params).
    return `${serverBase.replace(/\/+$/, "")}/assets/rpm/${id}.glb${u.search}`;
  } catch {
    return url;
  }
}

function toHttpServerAssetPath(pathname: string): string {
  const serverBase = (import.meta.env.VITE_HTTP_SERVER_URL as string | undefined) ?? "http://localhost:3001";
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${serverBase.replace(/\/+$/, "")}${normalized}`;
}

/**
 * Vite dev/preview only: same-origin path proxied to models.readyplayer.me (see vite.config `server.proxy`).
 * Avoids browser DNS blocks / CORS on `models.readyplayer.me` while the dev server can still reach RPM.
 */
function toViteDevRpmPath(url: string): string {
  try {
    const u = new URL(url);
    const m = /^\/([a-zA-Z0-9]+)\.glb$/.exec(u.pathname);
    if (!m) return url;
    return `/__rpm/${m[1]}.glb${u.search}`;
  } catch {
    return url;
  }
}

function rpmResolvedLoadUrl(avatarUrl: string, useRpmProxy: boolean): string {
  const preferViteDev =
    import.meta.env.DEV && import.meta.env.VITE_RPM_USE_VITE_DEV_PROXY !== "false";
  if (!avatarUrl) {
    if (/^https?:\/\/models\.readyplayer\.me\//i.test(DEMO_RPM)) {
      const q = ensureRpmQuery(DEMO_RPM);
      if (!useRpmProxy) return q;
      if (preferViteDev) return toViteDevRpmPath(q);
      return toLocalRpmProxy(q);
    }
    return DEMO_RPM;
  }
  if (avatarUrl.startsWith("http://") || avatarUrl.startsWith("https://")) {
    if (/^https?:\/\/models\.readyplayer\.me\//i.test(avatarUrl)) {
      const q = ensureRpmQuery(avatarUrl);
      if (!useRpmProxy) return q;
      if (preferViteDev) return toViteDevRpmPath(q);
      return toLocalRpmProxy(q);
    }
    return avatarUrl;
  }
  if (avatarUrl.startsWith("/")) return avatarUrl;
  return avatarUrl;
}

/** Same-origin RPM fetch: Express `/assets/rpm/` or Vite dev `/__rpm/`. */
export function isProxiedRpmAssetUrl(resolved: string): boolean {
  if (resolved.startsWith("/__rpm/")) return true;
  try {
    const u = new URL(resolved, typeof window !== "undefined" ? window.location.href : "http://localhost");
    return /\/assets\/rpm\//.test(u.pathname);
  } catch {
    return /\/assets\/rpm\//.test(resolved);
  }
}

/**
 * Browser-direct Ready Player Me GLB URL with viseme / compat query params.
 * Use when the local RPM proxy is down (502) but the client can still reach models.readyplayer.me.
 */
export function resolveRpmDirectGlbUrl(sourceUrl: string): string {
  if (!sourceUrl) return ensureRpmQuery(DEMO_RPM);
  if (/^https?:\/\/models\.readyplayer\.me\//i.test(sourceUrl)) return ensureRpmQuery(sourceUrl);
  return sourceUrl;
}

/** HTTPS Ready Player Me URL from persona config (or demo), or null if not RPM. */
function rpmHttpsSourceFromPersona(avatarUrl: string): string | null {
  const u = avatarUrl.trim();
  if (/^https?:\/\/models\.readyplayer\.me\//i.test(u)) return u;
  if (!u && /^https?:\/\/models\.readyplayer\.me\//i.test(DEMO_RPM)) return DEMO_RPM;
  return null;
}

/**
 * Ordered GLB URLs to try when loading RPM avatars (HEAD probe + loader).
 * Dev: Vite `/__rpm` → API `/assets/rpm` on {@link import.meta.env.VITE_HTTP_SERVER_URL} → direct HTTPS.
 */
export function buildRpmLoadCandidateUrls(avatarUrl: string): string[] | null {
  const src = rpmHttpsSourceFromPersona(avatarUrl);
  if (!src) return null;
  const q = ensureRpmQuery(src);
  const useRpmProxy = import.meta.env.VITE_RPM_USE_PROXY !== "false";
  const preferViteDev =
    import.meta.env.DEV && import.meta.env.VITE_RPM_USE_VITE_DEV_PROXY !== "false";
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (x: string) => {
    if (seen.has(x)) return;
    seen.add(x);
    out.push(x);
  };
  if (useRpmProxy) {
    if (preferViteDev) add(toViteDevRpmPath(q));
    add(toLocalRpmProxy(q));
  }
  add(q);
  return out;
}

/**
 * Ordered candidate URLs for local `/avatars/*.glb` assets.
 * Browser-first keeps the fast path for Vite/public assets, with a localhost API
 * fallback for cases where the page origin differs from the asset host.
 */
export function buildLocalAvatarLoadCandidateUrls(avatarUrl: string): string[] | null {
  if (!avatarUrl.startsWith("/")) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (x: string) => {
    if (seen.has(x)) return;
    seen.add(x);
    out.push(x);
  };
  add(avatarUrl);
  add(toHttpServerAssetPath(avatarUrl));
  return out;
}

export function resolveAvatarUrl(avatarUrl: string, overrideKey?: string | null): string {
  // Persona-specific local override so one uploaded avatar never leaks into every doctor.
  try {
    if (overrideKey) {
      const override = window.localStorage.getItem(`proxim.avatarOverrideUrl:${overrideKey}`);
      if (override && override.trim()) return override.trim();
    }
  } catch {
    // ignore
  }
  const useRpmProxy = import.meta.env.VITE_RPM_USE_PROXY !== "false";
  return rpmResolvedLoadUrl(avatarUrl, useRpmProxy);
}

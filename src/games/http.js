// Small fetch wrapper: timeout, JSON parsing, short-lived cache, clear errors.

export class NotFoundError extends Error {}
export class ApiError extends Error {}

const cache = new Map(); // url -> { expires, data }
const HEADERS = { "User-Agent": "DiscordStatsBot/1.0", Accept: "application/json" };

export async function getJSON(url, { ttl = 5 * 60_000, service = "the game API" } = {}) {
  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return hit.data;

  let res;
  try {
    res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new ApiError(`Couldn't reach ${service}. Try again in a bit.`);
  }
  if (res.status === 404 || res.status === 204) throw new NotFoundError("not found");
  if (res.status === 429) throw new ApiError(`${service} is rate-limiting us. Try again in a minute.`);
  if (!res.ok) throw new ApiError(`${service} returned an error (${res.status}). Try again later.`);

  const data = await res.json();
  cache.set(url, { expires: Date.now() + ttl, data });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return data;
}

// Runs async fn over items with limited concurrency (keeps us polite to APIs).
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]).catch(() => null);
    }
  });
  await Promise.all(workers);
  return out;
}

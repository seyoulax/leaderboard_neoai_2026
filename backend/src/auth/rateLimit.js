export function makeRateLimiter({ max, windowMs, now = () => Date.now() }) {
  const buckets = new Map();
  return {
    allow(key) {
      const t = now();
      const b = buckets.get(key);
      if (!b || b.resetAt <= t) {
        buckets.set(key, { count: 1, resetAt: t + windowMs });
        return true;
      }
      if (b.count >= max) return false;
      b.count += 1;
      return true;
    },
  };
}

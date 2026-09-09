// In-memory rate limiting using Token Bucket algorithm
const rateLimits = new Map();

// Periodic GC to prevent unbounded memory growth from IP tracking
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimits.entries()) {
    if (now - bucket.lastRefill > 300000) { // 5 minutes inactive
      rateLimits.delete(key);
    }
  }
}, 60000);

function getBucket(ip, type) {
  const key = `${ip}:${type}`;
  let bucket = rateLimits.get(key);
  
  if (!bucket) {
    const config = type === 'conn' ? { capacity: 1000, rate: 1000 / 60000 } : { capacity: 2000, rate: 2000 / 60000 };
    bucket = { tokens: config.capacity, lastRefill: Date.now(), config };
    rateLimits.set(key, bucket);
  }
  return bucket;
}

function consumeToken(ip, type) {
  const bucket = getBucket(ip, type);
  const now = Date.now();
  
  // Refill tokens
  const elapsed = now - bucket.lastRefill;
  const newTokens = elapsed * bucket.config.rate;
  
  if (newTokens > 0) {
    bucket.tokens = Math.min(bucket.config.capacity, bucket.tokens + newTokens);
    bucket.lastRefill = now;
  }
  
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return true; // Allowed
  }
  
  return false; // Rate limited
}

export function checkConnectionRateLimit(ip) {
  return consumeToken(ip, 'conn');
}

export function checkMessageRateLimit(ip) {
  return consumeToken(ip, 'msg');
}

export function validateOrigin(origin) {
  // Non-browser clients, native apps, or direct connections omit the Origin header
  if (!origin) return true;

  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    
    // Allow local development and mobile Capacitor environments
    if (host === 'localhost' || host === '127.0.0.1' || host === '10.0.2.2') return true;
    if (url.protocol === 'capacitor:' || origin.startsWith('capacitor://')) return true;
    
    // Allow verified production deployment domains and cloudflare tunnels
    if (host.endsWith('.onrender.com') || host.endsWith('.trycloudflare.com')) return true;
  } catch {
    return false;
  }

  return false;
}

// In-memory rate limiting using Token Bucket algorithm
const rateLimits = new Map();

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
  // Allow all origins over tunnel & native capacitor
  return true;
}

// In-memory rate limiting using Token Bucket algorithm
const rateLimits = new Map();

function getBucket(ip, type) {
  const key = `${ip}:${type}`;
  let bucket = rateLimits.get(key);
  
  if (!bucket) {
    const config = type === 'conn' ? { capacity: 30, rate: 30 / 60000 } : { capacity: 100, rate: 100 / 60000 };
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
  // Strict origin allow-list (for local dev and future production)
  const allowedOrigins = [
    'http://localhost:5173', 
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173'
  ];
  if (!origin) return true; // Some clients don't send origin in non-browser context
  return allowedOrigins.includes(origin);
}

import { createClient } from 'redis';

// We create an isolated Redis connection just for the rate limiter
// so it doesn't interfere with your webhook queues!
const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' });
redisClient.on('error', (err) => console.error('Rate Limiter Redis Error:', err));

// Connect once when the server starts
redisClient.connect().catch(console.error);

export const rateLimiter = async (req, res, next) => {
  try {
    // If the user isn't authenticated yet, let the auth middleware handle it first
    if (!req.user || !req.user.userId) {
      return next(); 
    }

    const userId = req.user.userId;
    const redisKey = `rate_limit:${userId}`;
    
    // --- THE RULES ---
    const MAX_REQUESTS = 5; // 5 requests allowed
    const WINDOW_SECONDS = 60; // per 60 seconds

    // 1. Increment the user's request count (Redis does this atomically, so it's thread-safe!)
    const currentRequests = await redisClient.incr(redisKey);

    // 2. If this is their very first request, start the 60-second countdown timer
    if (currentRequests === 1) {
      await redisClient.expire(redisKey, WINDOW_SECONDS);
    }

    // 3. Check if they have exceeded the limit
    if (currentRequests > MAX_REQUESTS) {
      console.warn(`🛑 Rate limit exceeded for user: ${userId}`);
      return res.status(429).json({
        error: 'Too Many Requests',
        message: `You have exceeded your BaaS tier limit of ${MAX_REQUESTS} requests per minute.`,
        retryAfter: 'Please wait a minute before trying again.'
      });
    }

    // 4. They are under the limit, let them through to the API!
    next();
  } catch (error) {
    console.error('Rate Limiter Failed:', error);
    // "Fail Open" Strategy: If Redis crashes, we let the request through 
    // rather than taking down the whole API for our customers.
    next(); 
  }
};
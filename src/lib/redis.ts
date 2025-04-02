import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  console.warn(
    'WARNING: REDIS_URL is not defined in environment variables. Using default redis://localhost:6379. Ensure Redis is running.'
  );
}

// Create a reusable Redis connection instance
// Options allow reconnection attempts etc.
const redis = new Redis(REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null, // Explicitly set to null for BullMQ
  enableReadyCheck: true,
  retryStrategy(times) {
    // Exponential backoff for reconnection attempts
    const delay = Math.min(times * 50, 2000); // Reconnect after 50ms, 100ms, ..., up to 2 seconds
    console.log(
      `Redis: Retrying connection attempt ${times}, delay ${delay}ms`
    );
    return delay;
  },
});

redis.on('connect', () => {
  console.log('Successfully connected to Redis.');
});

redis.on('error', (error) => {
  console.error('Redis connection error:', error);
  // Depending on the error, you might want to exit the process
  // For now, we rely on ioredis's retry strategy
});

export default redis;

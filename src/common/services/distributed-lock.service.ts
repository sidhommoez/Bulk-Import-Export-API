import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

export interface LockOptions {
  /** Time-to-live in milliseconds for the lock */
  ttlMs?: number;
  /** Number of retry attempts */
  retries?: number;
  /** Delay between retries in milliseconds */
  retryDelayMs?: number;
}

export interface Lock {
  key: string;
  token: string;
  expiresAt: Date;
}

const DEFAULT_LOCK_TTL_MS = 30000; // 30 seconds
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 100;

@Injectable()
export class DistributedLockService implements OnModuleDestroy {
  private readonly logger = new Logger(DistributedLockService.name);
  private readonly redis: Redis;
  private readonly nodeId: string;
  private readonly activeLocks: Map<string, NodeJS.Timeout> = new Map();

  constructor(private readonly configService: ConfigService) {
    this.nodeId = `node-${uuidv4().slice(0, 8)}-${process.pid}`;

    const redisHost = this.configService.get<string>('redis.host', 'localhost');
    const redisPort = this.configService.get<number>('redis.port', 6379);
    const redisPassword = this.configService.get<string>('redis.password');

    this.redis = new Redis({
      host: redisHost,
      port: redisPort,
      password: redisPassword || undefined,
      retryStrategy: (times) => {
        if (times > 3) {
          this.logger.error('Redis connection failed after 3 retries');
          return null;
        }
        return Math.min(times * 200, 2000);
      },
    });

    this.redis.on('error', (err) => {
      this.logger.error(`Redis error: ${err.message}`);
    });

    this.redis.on('connect', () => {
      this.logger.log(`Connected to Redis for distributed locking (nodeId: ${this.nodeId})`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    // Release all active locks
    for (const [key, timeout] of this.activeLocks.entries()) {
      clearInterval(timeout);
      try {
        await this.releaseLockByKey(key);
      } catch (error) {
        this.logger.warn(`Failed to release lock ${key} during shutdown: ${(error as Error).message}`);
      }
    }
    this.activeLocks.clear();

    // Close Redis connection
    await this.redis.quit();
    this.logger.log('Distributed lock service shut down');
  }

  /**
   * Get the unique node identifier
   */
  getNodeId(): string {
    return this.nodeId;
  }

  /**
   * Acquire a distributed lock
   * Uses Redis SET with NX (only if not exists) and PX (expiry in ms)
   */
  async acquireLock(resourceKey: string, options?: LockOptions): Promise<Lock | null> {
    const ttlMs = options?.ttlMs ?? DEFAULT_LOCK_TTL_MS;
    const retries = options?.retries ?? DEFAULT_RETRIES;
    const retryDelayMs = options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

    const lockKey = `lock:${resourceKey}`;
    const token = `${this.nodeId}:${uuidv4()}`;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // SET key value NX PX milliseconds
        // NX - Only set if key doesn't exist
        // PX - Set expiry in milliseconds
        const result = await this.redis.set(lockKey, token, 'PX', ttlMs, 'NX');

        if (result === 'OK') {
          const lock: Lock = {
            key: lockKey,
            token,
            expiresAt: new Date(Date.now() + ttlMs),
          };

          this.logger.debug(`Acquired lock ${lockKey} (token: ${token.slice(0, 16)}...)`);

          // Start lock renewal to prevent expiration during long operations
          this.startLockRenewal(lock, ttlMs);

          return lock;
        }

        // Lock is held by someone else
        if (attempt < retries) {
          this.logger.debug(
            `Lock ${lockKey} is held, retrying in ${retryDelayMs}ms (attempt ${attempt + 1}/${retries})`,
          );
          await this.sleep(retryDelayMs);
        }
      } catch (error) {
        this.logger.error(`Error acquiring lock ${lockKey}: ${(error as Error).message}`);
        if (attempt < retries) {
          await this.sleep(retryDelayMs);
        }
      }
    }

    this.logger.warn(`Failed to acquire lock ${lockKey} after ${retries + 1} attempts`);
    return null;
  }

  /**
   * Release a distributed lock
   * Uses Lua script to ensure we only delete if we own the lock
   */
  async releaseLock(lock: Lock): Promise<boolean> {
    // Stop renewal
    this.stopLockRenewal(lock.key);

    // Lua script ensures atomic check-and-delete
    // Only deletes if the token matches (we own the lock)
    const luaScript = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    try {
      const result = await this.redis.eval(luaScript, 1, lock.key, lock.token);

      if (result === 1) {
        this.logger.debug(`Released lock ${lock.key}`);
        return true;
      } else {
        this.logger.warn(`Lock ${lock.key} was not held by us or already expired`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Error releasing lock ${lock.key}: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Release a lock by key (used during shutdown)
   */
  private async releaseLockByKey(lockKey: string): Promise<void> {
    const token = await this.redis.get(lockKey);
    if (token && token.startsWith(this.nodeId)) {
      await this.redis.del(lockKey);
      this.logger.debug(`Released lock ${lockKey} during shutdown`);
    }
  }

  /**
   * Extend a lock's TTL
   */
  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    // Lua script to extend only if we own the lock
    const luaScript = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("pexpire", KEYS[1], ARGV[2])
      else
        return 0
      end
    `;

    try {
      const result = await this.redis.eval(luaScript, 1, lock.key, lock.token, ttlMs.toString());

      if (result === 1) {
        lock.expiresAt = new Date(Date.now() + ttlMs);
        this.logger.debug(`Extended lock ${lock.key} by ${ttlMs}ms`);
        return true;
      } else {
        this.logger.warn(`Failed to extend lock ${lock.key} - not owned or expired`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Error extending lock ${lock.key}: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Check if a lock is currently held
   */
  async isLocked(resourceKey: string): Promise<boolean> {
    const lockKey = `lock:${resourceKey}`;
    const result = await this.redis.exists(lockKey);
    return result === 1;
  }

  /**
   * Get information about who holds a lock
   */
  async getLockHolder(resourceKey: string): Promise<string | null> {
    const lockKey = `lock:${resourceKey}`;
    const token = await this.redis.get(lockKey);
    return token;
  }

  /**
   * Execute a function with a distributed lock
   * Automatically acquires and releases the lock
   */
  async withLock<T>(
    resourceKey: string,
    fn: () => Promise<T>,
    options?: LockOptions,
  ): Promise<T> {
    const lock = await this.acquireLock(resourceKey, options);

    if (!lock) {
      throw new Error(`Failed to acquire lock for resource: ${resourceKey}`);
    }

    try {
      return await fn();
    } finally {
      await this.releaseLock(lock);
    }
  }

  /**
   * Start automatic lock renewal
   * Renews the lock at half the TTL interval to prevent expiration
   */
  private startLockRenewal(lock: Lock, ttlMs: number): void {
    const renewalInterval = Math.floor(ttlMs / 2);

    const intervalId = setInterval(async () => {
      const extended = await this.extendLock(lock, ttlMs);
      if (!extended) {
        this.logger.warn(`Lock renewal failed for ${lock.key}, stopping renewal`);
        this.stopLockRenewal(lock.key);
      }
    }, renewalInterval);

    this.activeLocks.set(lock.key, intervalId);
  }

  /**
   * Stop lock renewal
   */
  private stopLockRenewal(lockKey: string): void {
    const intervalId = this.activeLocks.get(lockKey);
    if (intervalId) {
      clearInterval(intervalId);
      this.activeLocks.delete(lockKey);
    }
  }

  /**
   * Helper to sleep for a given duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export interface RateLimitConfig {
  endpoint: string;
  timeout: number;
  retryAttempts: number;
  apiKey?: string;
}

export interface RateLimitOptions {
  identifier: string;
  tier: 'PUBLIC' | 'STRICT' | 'ADMIN' | 'VIP_ADMIN' | 'API_KEY';
  tags?: Record<string, string>;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: Date;
  retryAfter?: number;
}

export class RateLimitClient {
  private readonly config: RateLimitConfig;
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(config: RateLimitConfig) {
    this.config = {
      timeout: 5000,
      retryAttempts: 3,
      ...config,
    };

    this.baseUrl = this.config.endpoint.replace(/\/$/, '');
    this.headers = {
      'Content-Type': 'application/json',
      'User-Agent': '@agrobridge/rate-limiting-client@1.0.0',
    };

    if (this.config.apiKey) {
      this.headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
  }

  async checkLimit(options: RateLimitOptions): Promise<RateLimitResult> {
    const start = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
      try {
        const response = await this.makeRequest(options);
        return this.parseResponse(response);
      } catch (err) {
        lastError = err as Error;

        if (attempt < this.config.retryAttempts - 1) {
          await this.backoff(attempt);
        }
      }
    }

    throw new Error(
      `Rate limit check failed after ${this.config.retryAttempts} attempts: ${lastError?.message}`,
    );
  }

  async checkLimitBatch(options: RateLimitOptions[]): Promise<Map<string, RateLimitResult>> {
    const promises = options.map((opt) => this.checkLimit(opt));
    const results = await Promise.all(promises);

    const resultMap = new Map<string, RateLimitResult>();
    options.forEach((opt, index) => {
      resultMap.set(opt.identifier, results[index]!);
    });

    return resultMap;
  }

  async checkLimitParallel(
    identifiers: string[],
    tier: RateLimitOptions['tier'],
  ): Promise<Map<string, RateLimitResult>> {
    const options = identifiers.map((identifier) => ({ identifier, tier }));
    return this.checkLimitBatch(options);
  }

  async incrementCounter(identifier: string, amount: number = 1): Promise<void> {
    try {
      await this.makeRequest({
        identifier,
        tier: 'API_KEY',
        operation: 'increment',
        amount,
      });
    } catch (err) {
      throw new Error(`Failed to increment counter: ${(err as Error).message}`);
    }
  }

  async getUsage(identifier: string, tier: RateLimitOptions['tier']): Promise<RateLimitResult> {
    try {
      const response = await this.makeRequest({
        identifier,
        tier,
        operation: 'get',
      });
      return this.parseResponse(response);
    } catch (err) {
      throw new Error(`Failed to get usage: ${(err as Error).message}`);
    }
  }

  async resetLimit(identifier: string): Promise<void> {
    try {
      await this.makeRequest({
        identifier,
        tier: 'API_KEY',
        operation: 'reset',
      });
    } catch (err) {
      throw new Error(`Failed to reset limit: ${(err as Error).message}`);
    }
  }

  private async makeRequest(
    options: RateLimitOptions & { operation?: string; amount?: number },
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const body = {
        identifier: options.identifier,
        tier: options.tier,
        tags: options.tags || {},
        operation: options.operation,
        amount: options.amount,
      };

      const response = await fetch(`${this.baseUrl}/v1/check`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private parseResponse(response: Response): RateLimitResult {
    return response.json().then((data) => ({
      allowed: data.allowed,
      limit: data.limit,
      remaining: data.remaining,
      resetTime: new Date(data.resetTime),
      retryAfter: data.retryAfter,
    }));
  }

  private async backoff(attempt: number): Promise<void> {
    const baseDelay = 100;
    const maxDelay = 2000;
    const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    const jitter = Math.random() * 50;

    await new Promise((resolve) => setTimeout(resolve, delay + jitter));
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number }> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: this.headers,
        signal: AbortSignal.timeout(this.config.timeout),
      });

      const latency = Date.now() - start;
      return {
        healthy: response.ok,
        latency,
      };
    } catch (err) {
      return {
        healthy: false,
        latency: Date.now() - start,
      };
    }
  }

  close(): void {}

  static createFromEnv(): RateLimitClient {
    return new RateLimitClient({
      endpoint: process.env.RATE_LIMITING_ENDPOINT || 'http://localhost:8080',
      timeout: parseInt(process.env.RATE_LIMITING_TIMEOUT || '5000', 10),
      retryAttempts: parseInt(process.env.RATE_LIMITING_RETRIES || '3', 10),
      apiKey: process.env.RATE_LIMITING_API_KEY,
    });
  }
}

export default RateLimitClient;

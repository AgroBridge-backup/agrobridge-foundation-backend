/**
 * Circuit Breaker State Machine
 * Manages state transitions for the circuit breaker pattern
 * 
 * @author Alejandro Navarro Ayala - CEO & Founder, AgroBridge
 */

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  halfOpenCalls: number;
  totalCalls: number;
  totalFailures: number;
  totalSuccesses: number;
  consecutiveSuccesses: number;
}

export interface StateTransition {
  from: CircuitState;
  to: CircuitState;
  reason: string;
  timestamp: number;
}

export class CircuitStateMachine {
  private state: CircuitBreakerState;
  private transitionHistory: StateTransition[] = [];
  private readonly maxHistorySize = 100;

  constructor(
    private readonly config: {
      failureThreshold: number;
      resetTimeoutMs: number;
      halfOpenMaxCalls: number;
      successThreshold: number;
    }
  ) {
    this.state = this.getInitialState();
  }

  private getInitialState(): CircuitBreakerState {
    return {
      state: CircuitState.CLOSED,
      failureCount: 0,
      successCount: 0,
      lastFailureTime: null,
      lastSuccessTime: null,
      halfOpenCalls: 0,
      totalCalls: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      consecutiveSuccesses: 0,
    };
  }

  getCurrentState(): Readonly<CircuitBreakerState> {
    return { ...this.state };
  }

  getState(): CircuitState {
    return this.state.state;
  }

  canExecute(): boolean {
    const now = Date.now();

    switch (this.state.state) {
      case CircuitState.CLOSED:
        return true;

      case CircuitState.OPEN:
        if (this.state.lastFailureTime && 
            now - this.state.lastFailureTime >= this.config.resetTimeoutMs) {
          this.transitionTo(CircuitState.HALF_OPEN, 'Reset timeout elapsed, testing service');
          return true;
        }
        return false;

      case CircuitState.HALF_OPEN:
        return this.state.halfOpenCalls < this.config.halfOpenMaxCalls;

      default:
        return false;
    }
  }

  recordSuccess(): void {
    this.state.totalCalls++;
    this.state.totalSuccesses++;
    this.state.lastSuccessTime = Date.now();
    this.state.consecutiveSuccesses++;

    switch (this.state.state) {
      case CircuitState.HALF_OPEN:
        this.state.successCount++;
        
        if (this.state.consecutiveSuccesses >= this.config.successThreshold) {
          this.transitionTo(CircuitState.CLOSED, 'Success threshold reached in half-open state');
        }
        break;

      case CircuitState.CLOSED:
        this.state.failureCount = 0;
        break;
    }
  }

  recordFailure(): void {
    const now = Date.now();
    this.state.totalCalls++;
    this.state.totalFailures++;
    this.state.failureCount++;
    this.state.lastFailureTime = now;
    this.state.consecutiveSuccesses = 0;

    switch (this.state.state) {
      case CircuitState.CLOSED:
        if (this.state.failureCount >= this.config.failureThreshold) {
          this.transitionTo(CircuitState.OPEN, `Failure threshold (${this.config.failureThreshold}) exceeded`);
        }
        break;

      case CircuitState.HALF_OPEN:
        this.transitionTo(CircuitState.OPEN, 'Failure detected in half-open state');
        break;
    }
  }

  recordHalfOpenCall(): void {
    if (this.state.state === CircuitState.HALF_OPEN) {
      this.state.halfOpenCalls++;
    }
  }

  private transitionTo(newState: CircuitState, reason: string): void {
    const oldState = this.state.state;
    
    if (oldState === newState) return;

    const transition: StateTransition = {
      from: oldState,
      to: newState,
      reason,
      timestamp: Date.now(),
    };

    this.transitionHistory.push(transition);
    
    if (this.transitionHistory.length > this.maxHistorySize) {
      this.transitionHistory.shift();
    }

    this.state.state = newState;

    if (newState === CircuitState.CLOSED) {
      this.state.failureCount = 0;
      this.state.successCount = 0;
      this.state.halfOpenCalls = 0;
      this.state.consecutiveSuccesses = 0;
    } else if (newState === CircuitState.HALF_OPEN) {
      this.state.halfOpenCalls = 0;
      this.state.successCount = 0;
      this.state.consecutiveSuccesses = 0;
    }
  }

  getTransitionHistory(): ReadonlyArray<StateTransition> {
    return [...this.transitionHistory];
  }

  reset(): void {
    this.state = this.getInitialState();
    this.transitionHistory = [];
  }

  getMetrics() {
    const now = Date.now();
    const timeSinceLastFailure = this.state.lastFailureTime 
      ? now - this.state.lastFailureTime 
      : null;

    return {
      state: this.state.state,
      failureCount: this.state.failureCount,
      successCount: this.state.successCount,
      totalCalls: this.state.totalCalls,
      totalFailures: this.state.totalFailures,
      totalSuccesses: this.state.totalSuccesses,
      failureRate: this.state.totalCalls > 0 
        ? (this.state.totalFailures / this.state.totalCalls) * 100 
        : 0,
      lastFailureTime: this.state.lastFailureTime,
      lastSuccessTime: this.state.lastSuccessTime,
      timeSinceLastFailure,
      consecutiveSuccesses: this.state.consecutiveSuccesses,
      halfOpenCalls: this.state.halfOpenCalls,
      transitionCount: this.transitionHistory.length,
    };
  }
}

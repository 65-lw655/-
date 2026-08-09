import type { AuthState, AuthStateStore } from "./auth-state.js";

function createEmptyState(): AuthState {
  return {
    version: 1,
    users: [],
    sessions: [],
    tickets: [],
    loginAttempts: [],
    auditEvents: []
  };
}

export class MemoryAuthStateStore implements AuthStateStore {
  private state: AuthState;
  private updateQueue: Promise<void> = Promise.resolve();

  constructor(initialState: AuthState = createEmptyState()) {
    this.state = structuredClone(initialState);
  }

  async read<T>(reader: (state: Readonly<AuthState>) => T): Promise<T> {
    await this.updateQueue;
    return reader(structuredClone(this.state));
  }

  update<T>(mutator: (state: AuthState) => T | Promise<T>): Promise<T> {
    const operation = this.updateQueue.then(async () => {
      const nextState = structuredClone(this.state);
      const result = await mutator(nextState);
      this.state = nextState;
      return result;
    });

    this.updateQueue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }
}

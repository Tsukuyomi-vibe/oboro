export class ConfigurationQueue {
  private pending: Promise<void> = Promise.resolve();
  run<T>(action: () => Promise<T>): Promise<T> {
    const result = this.pending.then(action);
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }
}

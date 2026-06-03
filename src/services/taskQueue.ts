type Job<T = any> = () => Promise<T>;

export class TaskQueue {
  private concurrency: number;
  private running = 0;
  private queue: Array<{ job: Job; resolve: (v?: any) => void; reject: (e: any) => void }> = [];

  constructor(concurrency = 2) {
    this.concurrency = concurrency;
  }

  add<T = any>(job: Job<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ job, resolve, reject });
      this.runNext();
    });
  }

  private runNext() {
    if (this.running >= this.concurrency) return;
    const item = this.queue.shift();
    if (!item) return;
    this.running++;
    item.job()
      .then((res) => item.resolve(res))
      .catch((err) => item.reject(err))
      .finally(() => {
        this.running--;
        setImmediate(() => this.runNext());
      });
  }

  size() {
    return this.queue.length;
  }
}

export const taskQueue = new TaskQueue(Number(process.env.WORKER_CONCURRENCY || 2));

export default taskQueue;

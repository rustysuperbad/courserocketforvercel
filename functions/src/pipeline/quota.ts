import { PIPELINE_CONFIG } from "./config";

export type QuotaLedger = {
  reserve(usd: number): Promise<void>;
  settle(actualUsd: number): Promise<void>;
  release(): Promise<void>;
  reserved(): number;
  spent(): number;
};

export class MemoryQuota implements QuotaLedger {
  private held = 0;
  private paid = 0;
  private stack: number[] = [];
  constructor(private readonly cap = PIPELINE_CONFIG.runBudgetUsd) {}
  async reserve(usd: number): Promise<void> {
    if (this.held + this.paid + usd > this.cap) throw new Error("quota_exceeded");
    this.held += usd;
    this.stack.push(usd);
  }
  async settle(actualUsd: number): Promise<void> {
    const reserved = this.stack.pop() || 0;
    this.held = Math.max(0, this.held - reserved);
    this.paid += Math.max(0, actualUsd);
  }
  async release(): Promise<void> {
    const reserved = this.stack.pop() || 0;
    this.held = Math.max(0, this.held - reserved);
  }
  reserved(): number { return this.held; }
  spent(): number { return this.paid; }
}

export async function withReservation<T>(ledger: QuotaLedger, usd: number, fn: () => Promise<T>): Promise<T> {
  await ledger.reserve(usd);
  try {
    const result = await fn();
    return result;
  } catch (error) {
    await ledger.release();
    throw error;
  }
}

import type { AccountFolder } from "./folder.js";
import type { NodeSummary } from "./summary.js";
import type { Orientation } from "../ledger.js";
import { unscale, type Position } from "../positions.js";
import type { Transaction } from "../transactions/transaction.js";


/**
 * Every node in the account tree (leaf account, folder, or computed account) satisfies
 * this interface. Balances vary along two axes:
 *
 * - **sign**: `getSignedBalanceScaled` uses the ledger-wide lot convention (UTXO positive,
 *   UTXI negative) that makes the zero-sum invariant hold, before orientation. `getBalanceScaled`
 *   (and the human-scaled `getBalance`) additionally apply the node's effective
 *   {@link Orientation} so the account presents its natural sign.
 * - **unit**: `getSignedBalanceScaled` / `getBalanceScaled` return `bigint` smallest units for
 *   precision; `getBalance` / `getBalances` return human-readable `number` (scaled by
 *   `position.decimals`).
 */

export type AccountName = string | {positive: string, negative: string, zero?: string};

export function getDisplayName(name: AccountName, balance: number): string {
    if (typeof name === "string") return name;

    if (balance < 0) return name.negative;
    if (balance && name.zero) return name.zero;

    return name.positive;
}

export abstract class AccountNode {
    constructor(
        public name: string | {positive: string, negative: string},
        public localOrientation: Orientation,
        public parent: AccountFolder | null
    ) {}

    abstract getSignedBalanceScaled(position: Position, transactions: Transaction[]): bigint;
    abstract getSignedBalancesScaled(transactions: Transaction[]): Map<Position, bigint>;
    abstract summarize(position: Position, transactions: Transaction[]): NodeSummary;
    
    public getEffectiveOrientation(): Orientation {
        if (this.parent === null) return this.localOrientation;
        return this.parent.getEffectiveOrientation() * this.localOrientation;
    }

    public getBalanceScaled(position: Position, transactions: Transaction[]): bigint {
        return BigInt(this.getEffectiveOrientation()) * this.getSignedBalanceScaled(position, transactions);
    }

    public getBalancesScaled(transactions: Transaction[]): Map<Position, bigint> {
        const result = new Map<Position, bigint>();
        for (const [position, signed] of this.getSignedBalancesScaled(transactions))
            result.set(position, BigInt(this.getEffectiveOrientation()) * signed);
        return result;
    }

    public getBalance(position: Position, transactions: Transaction[]): number {
        return unscale(this.getBalanceScaled(position, transactions), position);
    }

    public getBalances(transactions: Transaction[]): Map<Position, number> {
        const result = new Map<Position, number>();
        for (const [pos, raw] of this.getBalancesScaled(transactions)) result.set(pos, unscale(raw, pos));
        return result;
    }
}

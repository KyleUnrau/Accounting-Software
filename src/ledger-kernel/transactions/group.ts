import type { Transaction } from "./transaction.js";
import { TransactionNode } from "./node.js";

/**
 * The semantic base abstraction for a structured bundle of {@link Transaction}s. Every accounting
 * operation that spans more than one atomic transaction — an exchange, a terminal expense, an
 * internal sequential bundle — is a `TransactionGroup` subclass that preserves its named roles
 * while still producing a deterministic flat list for the ledger.
 *
 * **It is not authoritative.** The flat `Ledger.transactions` array remains the single source of
 * truth for lot availability, cost-basis lineage, and `Ledger.verify()`. A group only holds
 * references — by identity — to already-committed transactions, so removing every group leaves
 * the ledger's mechanics untouched.
 *
 * A `TransactionGroup` is itself a {@link TransactionNode}, so it can nest inside another group or
 * be recorded as one member of a {@link LedgerEvent} — but it is not a `LedgerEvent` itself; ledger
 * history is a flat sequence of events, never a mix of bare transaction groups and events.
 *
 * Concrete subclasses:
 * - {@link OrderedTransactionGroup} — generic, anonymous sequential bundle
 * - `ExchangeTransactions` — semantic exchange bundle with named `from`, `to`, `intermediates`,
 *   `terminalLoss`, `resolution` fields
 * - `TerminalTransactions` — semantic terminal-expense bundle with named `from`, `intermediates`,
 *   `externalTerminals`, `resolution` fields
 */
export abstract class TransactionGroup extends TransactionNode {
    /** Discriminant for runtime inspection of what kind of accounting operation this group represents. */
    public abstract readonly kind: string;

    /**
     * The immediate children of this group, each of which is either a leaf {@link Transaction} or
     * a nested {@link TransactionGroup}. Implementations filter out empty children so that callers
     * see only meaningful members (e.g. `ExchangeTransactions` omits its `intermediates` when the
     * exchange requires no intermediate hops).
     */
    public abstract get members(): readonly TransactionNode[];

    /**
     * All leaf {@link Transaction}s in depth-first order — exactly the sequence committed to the
     * ledger. Derived from {@link members} so that member ordering is the single source of truth;
     * subclasses that override `members` get the correct `flatten()` for free.
     */
    public flatten(): readonly Transaction[] {
        return this._flat ??= this.members.flatMap(member => member.flatten());
    }
    private _flat?: readonly Transaction[];

    /** True when this group contributes no leaf transactions (e.g. an empty hop list). */
    public get isEmpty(): boolean {
        return this.members.length === 0;
    }
}

/**
 * A generic, ordered bundle of {@link TransactionNode}s. Used for internal sequential groupings
 * that carry no domain meaning of their own beyond "these items happen in this order" — e.g. the
 * per-position hop transactions of a multi-hop unwind, or the per-origin terminal recognition
 * transactions.
 */
export class OrderedTransactionGroup extends TransactionGroup {
    public readonly kind = "ordered";

    constructor(
        private readonly _members: readonly TransactionNode[]
    ) {
        super();
    }

    public get members(): readonly TransactionNode[] {
        return this._members;
    }
}
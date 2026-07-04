import type { Transaction } from "./transaction.js";

/**
 * Base abstraction for anything allowed to appear as a member of a {@link TransactionGroup} —
 * either a {@link Transaction} leaf or a nested {@link TransactionGroup}. Both implement
 * {@link flatten} so {@link EventBuilder.record} and the ledger machinery can treat them
 * uniformly, without any lossy conversion step like `.toGroup()`.
 *
 * The private brand makes this nominal rather than structural: a class that merely has a matching
 * `flatten()` method but does not actually `extend TransactionNode` — notably {@link LedgerEvent},
 * which is a ledger-level concept, not a transaction-composition primitive — is not assignable
 * here. A `LedgerEvent` can therefore never be nested inside a `TransactionGroup`'s members or
 * another `LedgerEvent`.
 */
export abstract class TransactionNode {
    private readonly _transactionNodeBrand = "TransactionNode" as const;
    public abstract flatten(): readonly Transaction[];
}

/**
 * An object that can construct a {@link TransactionNode} but is not itself already flattened.
 * Resolution objects ({@link ExchangeResolution}, {@link TerminalResolution}) satisfy this through
 * their existing `constructTransactions()` methods, enabling call sites like:
 *
 *   event.record(exchangeResolution);
 *   event.record(terminalResolution);
 *
 * Because `constructTransactions()` may accept optional parameters, implementations are free to
 * add them; the interface covers only the no-argument invocation.
 */
export interface TransactionNodeFactory<T extends TransactionNode = TransactionNode> {
    constructTransactions(): T;
}

/**
 * Type guard distinguishing {@link TransactionNode} from {@link TransactionNodeFactory}.
 * Used by {@link EventBuilder.record} to accept either without requiring a manual call to
 * `constructTransactions()`.
 */
export function isTransactionNode(
    v: TransactionNode | TransactionNodeFactory
): v is TransactionNode {
    return typeof (v as TransactionNodeFactory).constructTransactions !== "function";
}

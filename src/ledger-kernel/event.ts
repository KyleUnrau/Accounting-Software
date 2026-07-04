import { ExchangeResolution, ExchangeTransactions } from "../equity-policy/exchange.js";
import { TerminalResolution, type TerminalTransactions } from "../equity-policy/terminal.js";
import type { Ledger } from "./ledger.js";
import type { TransactionGroup } from "./transactions/group.js";
import { type TransactionNode, type TransactionNodeFactory, isTransactionNode } from "./transactions/node.js";
import { type StagedExchange, type StagedTransaction, type StagedTerminal, materializeInputs, materializeOutputs } from "./transactions/staged.js";
import { Transaction } from "./transactions/transaction.js";

/**
 * Accumulates one or more transaction nodes into a single {@link LedgerEvent}. Also doubles as the
 * staging session for materializing a not-yet-recorded {@link Transaction}: callers describe what
 * they want with {@link StagedInput}/{@link StagedOutput} specs, and {@link stageTransaction} /
 * {@link stageExchange} / {@link stageTerminal} materialize them into real inputs/outputs against
 * {@link view} at the moment the transaction is actually constructed — the only point a correct
 * availability snapshot exists. No partially-materialized state is ever exposed between calls.
 *
 * Obtain one via {@link Ledger.beginEvent}.
 */
export class EventBuilder {
    public readonly members: TransactionNode[] = [];
    private readonly _stagedFlat: Transaction[] = [];

    constructor(private readonly ledger: Ledger) { }

    /**
     * The live ledger transactions plus all transactions already recorded in this event — the full
     * availability surface for materializing subsequent inputs or outputs within the same event.
     */
    public view(): Transaction[] {
        return [...this.ledger.transactions, ...this._stagedFlat];
    }

    public stageTransaction(stagedTransaction: StagedTransaction): Transaction {
        const view = this.view();
        const transaction = new Transaction(materializeInputs(stagedTransaction.inputs, view), materializeOutputs(stagedTransaction.outputs, view), view);
        this.record(transaction);
        return transaction;
    }

    public stageExchange(stagedExchange: StagedExchange): ExchangeTransactions {
        const view = this.view();
        const resolution = new ExchangeResolution(
            materializeInputs(stagedExchange.fromInputs, view),
            materializeOutputs(stagedExchange.toOutputs, view),
            stagedExchange.residual,
            stagedExchange.exchange,
            view,
            this.ledger.engine
        );

        const transactions = resolution.constructTransactions();
        this.record(transactions);

        return transactions;
    }

    public stageTerminal(stagedTerminal: StagedTerminal): TerminalTransactions {
        const view = this.view();
        const resolution = new TerminalResolution(
            materializeInputs(stagedTerminal.inputs, view),
            stagedTerminal.account,
            view,
            this.ledger.engine
        );

        const transactions = resolution.constructTransactions();
        this.record(transactions);

        return transactions;
    }

    /**
     * Nests `input` under the event and makes its transactions visible to subsequent draws via
     * {@link view}. Accepts any {@link TransactionNode} (a {@link Transaction}, any
     * {@link TransactionGroup} subclass, etc.) or any {@link TransactionNodeFactory} whose
     * `constructTransactions()` will be called to obtain the node (e.g. a resolution object).
     */
    public record(input: TransactionNode | TransactionNodeFactory): void {
        const node = isTransactionNode(input) ? input : input.constructTransactions();
        this.members.push(node);
        this._stagedFlat.push(...node.flatten());
    }

    public generateEvent(): LedgerEvent {
        return new LedgerEvent(this.members);
    }

    /** Registers the accumulated nodes as one top-level ledger event. */
    public register(): LedgerEvent {
        return this.ledger.appendEvent(this.generateEvent());
    }
}

/**
 * A single top-level entry in the ledger's history — the unit `Ledger.events` is made of. Bundles
 * one or more {@link TransactionNode}s (transactions and/or transaction groups) recorded together
 * within one {@link EventBuilder} session. Every registered ledger entry is a `LedgerEvent`, even
 * one holding a single transaction or a single semantic bundle like `ExchangeTransactions` — ledger
 * history is a flat, uniform sequence of events, never a mix of bare transaction groups and events.
 *
 * `LedgerEvent` deliberately does not extend {@link TransactionGroup} / `TransactionNode`: an event
 * is a ledger-level concept, not a transaction-composition primitive, so it can never be nested
 * inside a `TransactionGroup`'s members or another `LedgerEvent` (see the brand on `TransactionNode`).
 */
export class LedgerEvent {
    constructor(
        private readonly _members: readonly TransactionNode[]
    ) { }

    public get members(): readonly TransactionNode[] {
        return this._members;
    }

    /** All leaf {@link Transaction}s in this event, in commit order. */
    public flatten(): readonly Transaction[] {
        return this.members.flatMap(member => member.flatten());
    }
}

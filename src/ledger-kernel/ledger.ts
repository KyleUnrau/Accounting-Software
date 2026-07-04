import type { Position } from "./positions.js";
import type { Result } from "../utils.js";
import { EventBuilder, LedgerEvent, type ExchangeParameters, type StagedTransaction, type TerminalParameters } from "./event.js";
import { Transaction } from "./transactions/transaction.js";
import { materializeInputs, materializeOutputs } from "./transactions/staged.js";
import type { AccountFolder } from "./accounts/folder.js";
import type { FolderSummary } from "./accounts/summary.js";
import { ProvenanceEngine } from "../equity-policy/provenance/engine.js";
import { ExchangeResolution } from "../equity-policy/exchange.js";
import { TerminalResolution } from "../equity-policy/terminal.js";

export enum Orientation {
    Positive = 1,
    Negative = -1
}

/**
 * The top-level container for a double-entry ledger. Holds the ordered {@link Transaction}
 * history and the two root {@link AccountFolder}s (`netAssets` and `equity`). All balance
 * queries and the structural invariant check run through this class.
 */
export class Ledger {
    public events: LedgerEvent[] = [];

    /**
     * The flat commit history, in order. Callers (e.g. {@link BookValueEngine}) routinely capture
     * this array once and rely on later commits remaining visible through that same reference —
     * so this is a single array mutated in place by {@link appendEvent}, not a value recomputed
     * fresh from `groups` on every access.
     */
    public readonly transactions: Transaction[] = [];

    /**
     * Traces cost basis over the live {@link transactions} history. Constructed once per ledger
     * (not per call) since `transactions` is mutated in place — the engine sees every later commit
     * through that same reference, so there is never a need to rebuild it after the fact.
     */
    public readonly engine: ProvenanceEngine;

    constructor(
        public netAssets: AccountFolder,
        public equity: AccountFolder
    ) {
        this.engine = new ProvenanceEngine(this.transactions);
    }

    public beginEvent(): EventBuilder {
        return new EventBuilder(this);
    }

    /** Registers an already-built {@link LedgerEvent} as a top-level ledger entry. Used by {@link EventBuilder.register}. */
    public appendEvent(event: LedgerEvent): LedgerEvent {
        this.events.push(event);
        this.transactions.push(...event.flatten());
        return event;
    }

    public newTransaction(spec: StagedTransaction): LedgerEvent {
        const transaction = new Transaction(materializeInputs(spec.inputs, this.transactions), materializeOutputs(spec.outputs, this.transactions), this.transactions);
        const event = new LedgerEvent([transaction]);

        this.appendEvent(event);

        return event;
    }

    public newExchange(parameters: ExchangeParameters): LedgerEvent {
        const resolution = new ExchangeResolution(
            materializeInputs(parameters.fromInputs, this.transactions),
            materializeOutputs(parameters.toOutputs, this.transactions),
            parameters.residual,
            parameters.exchange,
            this.transactions,
            this.engine
        );

        const transactions = resolution.constructTransactions();

        const event = new LedgerEvent([transactions]);
        this.appendEvent(event);

        return event;
    }

    public newTerminal(parameters: TerminalParameters): LedgerEvent {
        const resolution = new TerminalResolution(
            materializeInputs(parameters.inputs, this.transactions),
            parameters.account,
            this.transactions,
            this.engine
        );

        const transactions = resolution.constructTransactions();

        const event = new LedgerEvent([transactions]);
        this.appendEvent(event);

        return event;
    }

    public getSignedBalancesScaled(): Map<Position, bigint> {
        const signedBalances = new Map<Position, bigint>();

        for (const [position, balance] of this.netAssets.getSignedBalancesScaled(this.transactions))
            signedBalances.set(position, balance + (signedBalances.get(position) ?? 0n));
        for (const [position, balance] of this.equity.getSignedBalancesScaled(this.transactions))
            signedBalances.set(position, balance + (signedBalances.get(position) ?? 0n));

        return signedBalances;
    }

    /**
     * Checks that every position's combined root balance across `netAssets` and `equity`
     * sums to zero (within floating-point epsilon). Open exchange positions are automatically
     * accounted for via {@link ExchangePositionsAccount} in the equity tree — no external
     * adjustment is needed.
     */
    public verify(): Result<undefined, Error> {
        const signedBalances = this.getSignedBalancesScaled();

        for (const [position, balance] of signedBalances) {
            if (balance !== 0n) return {ok: false, error: new Error(`Ledger invalid, root balance for ${position.name} calculated as ${balance} instead of 0`)};
        }

        // Backstop: no lot may ever be over-consumed. The per-transaction check catches double-spend
        // within a single transaction, but over-consumption spread across separately-constructed
        // transactions in one batch can only be detected here, against the full committed history.
        for (const account of [...this.netAssets.getAccounts(), ...this.equity.getAccounts()]) {
            for (const store of account.lotStores.values()) {
                for (const utxo of store.utxos) {
                    if (utxo.calculateAvailable(this.transactions) < 0n) return {ok: false, error: new Error(`Ledger invalid, a UTXO for ${utxo.position.name} in account "${account.name}" has been over-consumed (available ${utxo.calculateAvailable(this.transactions)})`)};
                }
                for (const utxi of store.utxis) {
                    if (utxi.calculateAvailable(this.transactions) < 0n) return {ok: false, error: new Error(`Ledger invalid, a UTXI for ${utxi.position.name} in account "${account.name}" has been over-consumed (available ${utxi.calculateAvailable(this.transactions)})`)};
                }
            }
        }

        return {ok: true, value: undefined};
    }

    public summarize(position: Position): LedgerSummary {
        return {
            position,
            netAssets: this.netAssets.summarize(position, this.transactions),
            equity: this.equity.summarize(position, this.transactions),
        };
    }
}

export interface LedgerSummary {
    position: Position;
    netAssets: FolderSummary;
    equity: FolderSummary;
}
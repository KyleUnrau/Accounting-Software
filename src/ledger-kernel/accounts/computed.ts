import type { Orientation } from "../ledger.js";
import type { Position } from "../positions.js";
import type { Transaction } from "../transactions/transaction.js";
import { ResidualUTXI } from "../transactions/special-edges/residual.js";
import { ExchangedUTXI, ExchangedUTXO } from "../transactions/special-edges/exchange.js";
import { TerminalUTXO } from "../transactions/special-edges/terminal.js";
import { AccountNode, getDisplayName, type AccountName } from "./node.js";
import type { AccountSummary } from "./summary.js";
import type { AccountFolder } from "./folder.js";

/**
 * Base class for read-only accounts whose balance is derived by scanning the transaction
 * history rather than being tracked via explicit lot entries. Subclasses implement
 * `getSignedBalanceScaled` and `getSignedBalancesScaled`; the common orientation and display
 * logic lives here. No `generateInputs` or `generateOutputs` — these accounts cannot be used
 * as sources or destinations in transaction construction.
 */
export abstract class ComputedAccount extends AccountNode {
    constructor(
        name: AccountName,
        localOrientation: Orientation,
        parent: AccountFolder | null
    ) {
        super(name, localOrientation, parent);
    }

    public getEffectiveOrientation(): Orientation {
        if (this.parent === null) return this.localOrientation;
        return this.parent.getEffectiveOrientation() * this.localOrientation;
    }

    public abstract getSignedBalanceScaled(position: Position, transactions: Transaction[]): bigint;
    public abstract getSignedBalancesScaled(transactions: Transaction[]): Map<Position, bigint>;

    public summarize(position: Position, transactions: Transaction[]): AccountSummary {
        const balance: number = this.getBalance(position, transactions);
        return {
            name: getDisplayName(this.name, balance),
            orientation: {local: this.localOrientation, effective: this.getEffectiveOrientation()},
            balance
        };
    }
}

/**
 * Tracks all open exchange positions scoped to this account as an equity account. Scans every
 * {@link ExchangedUTXO} whose exchange's {@link Exchange.fromAccount} is this account (from-side)
 * and every {@link ExchangedUTXI} whose {@link Exchange.toAccount} is this account (to-side) for
 * their remaining availability. Matched exchange pairs at the same locked rate cancel to zero, so
 * only truly unresolved positions carry a balance. An exchange's two sides may book to different
 * accounts (see {@link ExchangeTarget}); each side counts only in the account that books it.
 *
 * Adding this as a child of the equity folder ensures `equity.getSignedBalancesScaled()` includes
 * open positions automatically — no adjustment is needed inside `ledger.verify()`.
 */
export class ExchangeAccount extends ComputedAccount {
    public getSignedBalanceScaled(position: Position, transactions: Transaction[]): bigint {
        let balance = 0n;
        for (const tx of transactions) {
            for (const output of tx.outputs)
                if (output instanceof ExchangedUTXO && output.position === position && output.account === this)
                    balance += output.calculateAvailable(transactions);
            for (const input of tx.inputs)
                if (input instanceof ExchangedUTXI && input.position === position && input.account === this)
                    balance -= input.calculateAvailable(transactions);
        }
        return balance;
    }

    public getSignedBalancesScaled(transactions: Transaction[]): Map<Position, bigint> {
        const positions = new Set<Position>();
        for (const tx of transactions) {
            for (const output of tx.outputs)
                if (output instanceof ExchangedUTXO && output.account === this)
                    positions.add(output.position);
            for (const input of tx.inputs)
                if (input instanceof ExchangedUTXI && input.account === this)
                    positions.add(input.position);
        }
        const result = new Map<Position, bigint>();
        for (const position of positions) {
            const balance = this.getSignedBalanceScaled(position, transactions);
            if (balance !== 0n) result.set(position, balance);
        }
        return result;
    }
}

/**
 * Tracks recognized **gains** as an equity account. A gain is a *directional suspended residual
 * edge*: a {@link ResidualUTXI} carrying its origin-position residual-basis, recognized at its
 * surface and able to later carry back toward its origin. Like {@link ExchangeAccount}, this
 * account holds no lot list of its own — {@link addResidualInput} (called by
 * {@link ExchangeResolution} and {@link TerminalResolution}) only mints the lot and hands it back
 * for the caller to place in a transaction; the balance is derived by scanning `transactions` for
 * committed {@link ResidualUTXI}s whose `.account` is this account. Multiple ResidualAccounts
 * (e.g. "Capital Gains", "FX Gains") can coexist without crosstalk.
 *
 * Losses are **not** held here — they are terminal and settle into a {@link TerminalAccount} at
 * their cost-basis origin. Gains reduce the root balance (increasing equity inside a
 * positive-orientation equity folder like netIncome).
 */
export class ResidualAccount extends ComputedAccount {
    public addResidualInput(quantity: bigint, position: Position, originBasis: Map<Position, bigint>): ResidualUTXI {
        return new ResidualUTXI(quantity, position, originBasis, this);
    }

    public getSignedBalanceScaled(position: Position, transactions: Transaction[]): bigint {
        let balance = 0n;
        for (const tx of transactions)
            for (const input of tx.inputs)
                if (input instanceof ResidualUTXI && input.position === position && input.account === this)
                    balance -= input.calculateAvailable(transactions);
        return balance;
    }

    public getSignedBalancesScaled(transactions: Transaction[]): Map<Position, bigint> {
        const positions = new Set<Position>();
        for (const tx of transactions)
            for (const input of tx.inputs)
                if (input instanceof ResidualUTXI && input.account === this) positions.add(input.position);
        const result = new Map<Position, bigint>();
        for (const position of positions) {
            const balance = this.getSignedBalanceScaled(position, transactions);
            if (balance !== 0n) result.set(position, balance);
        }
        return result;
    }
}

/**
 * A **terminal sink** for final origin-basis settlement events — expenses, realized exchange losses,
 * and negative-residual settlements. Unlike an ordinary {@link Account}, it has **no**
 * `generateInputs`/`generateOutputs`: it can never be a transaction *source*, and the
 * {@link TerminalUTXO}s it emits are non-consumable. It therefore records final settlement value
 * (participating in net-zero and summaries) without ever becoming spendable inventory.
 *
 * Recognitions are minted via {@link recognize}, which only constructs a {@link TerminalUTXO} and
 * hands it back for the caller to place in a transaction's outputs — this account holds no list of
 * its own. The balance is derived by scanning `transactions` for committed {@link TerminalUTXO}s
 * whose `.account` is this account, mirroring how {@link ExchangeAccount} derives its balance.
 */
export class TerminalAccount extends ComputedAccount {
    /** Mints a terminal settlement record for `quantity` in `position`, owned by this account. Place it in a transaction's outputs. */
    public recognize(quantity: bigint, position: Position): TerminalUTXO {
        return new TerminalUTXO(quantity, position, this);
    }

    public getSignedBalanceScaled(position: Position, transactions: Transaction[]): bigint {
        let balance = 0n;
        for (const tx of transactions)
            for (const output of tx.outputs)
                if (output instanceof TerminalUTXO && output.position === position && output.account === this)
                    balance += output.calculateAvailable(transactions);
        return balance;
    }

    public getSignedBalancesScaled(transactions: Transaction[]): Map<Position, bigint> {
        const positions = new Set<Position>();
        for (const tx of transactions)
            for (const output of tx.outputs)
                if (output instanceof TerminalUTXO && output.account === this) positions.add(output.position);
        const result = new Map<Position, bigint>();
        for (const position of positions) {
            const balance = this.getSignedBalanceScaled(position, transactions);
            if (balance !== 0n) result.set(position, balance);
        }
        return result;
    }
}

/**
 * Routes recognized residual value: gains to a {@link ResidualAccount} (a suspended residual-basis
 * edge that may later carry back), losses to a {@link TerminalAccount} (a final sink at origin —
 * losses are terminal, never movable destination lots).
 */
export type ResidualTarget = { gain: ResidualAccount; loss: TerminalAccount; };

/** Returns the {@link ResidualAccount} that should receive gain residuals from `target`. */
export function gainAccountOf(target: ResidualTarget): ResidualAccount {
    return target.gain;
}

/** Returns the {@link TerminalAccount} that should sink loss settlements from `target`. */
export function lossAccountOf(target: ResidualTarget): TerminalAccount {
    return target.loss;
}


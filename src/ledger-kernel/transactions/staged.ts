import type { Account } from "../accounts/account.js";
import type { Position } from "../positions.js";
import type { TransactionLike } from "./transaction.js";
import type { Input } from "./inputs.js";
import type { Output } from "./outputs.js";
import type { ResidualTarget, TerminalAccount } from "../accounts/computed.js";
import type { ExchangeTarget } from "./special-edges/exchange.js";
import { toArray } from "../../utils.js";

/**
 * A declarative, unresolved draw against an account — just what to draw and how much, with no
 * transaction view and no reference to any real lot. Callers building a transaction should only
 * ever produce these; the real {@link Input}s are materialized by {@link materializeInputs}, at
 * the point a transaction is actually constructed, against whichever view is correct there.
 */
export interface StagedInput {
    account: Account;
    position: Position;
    quantity: number | bigint;
}

/** The output-side counterpart of {@link StagedInput}. Materialized by {@link materializeOutputs}. */
export interface StagedOutput {
    account: Account;
    position: Position;
    quantity: number | bigint;
}

export interface StagedTransaction {
    inputs: StagedInput | StagedInput[];
    outputs: StagedOutput | StagedOutput[];
}

export interface StagedExchange {
    fromInputs: StagedInput | StagedInput[];
    toOutputs: StagedOutput | StagedOutput[];
    residual: ResidualTarget;
    exchange: ExchangeTarget;
}

export interface StagedTerminal {
    inputs: StagedInput | StagedInput[];
    account: TerminalAccount;
}

/**
 * Resolves `specs` into real {@link Input}s against `transactions`. Each spec is resolved in
 * order against `transactions` plus everything already resolved earlier in this same call, so
 * multiple specs drawing on the same account + position within one transaction can't double-draw
 * the same lot — this is the one place that reservation bookkeeping needs to exist at all.
 */
export function materializeInputs(stagedInput: StagedInput | readonly StagedInput[], transactions: readonly TransactionLike[]): Input[] {
    const resolved: Input[] = [];
    for (const spec of toArray(stagedInput)) {
        const generated = spec.account.generateInputs(spec.position, spec.quantity, [...transactions, { inputs: resolved, outputs: [] }]);
        resolved.push(...generated);
    }
    return resolved;
}

/** The output-side counterpart of {@link materializeInputs}. */
export function materializeOutputs(stagedOutput: StagedOutput | readonly StagedOutput[], transactions: readonly TransactionLike[]): Output[] {
    const resolved: Output[] = [];
    for (const spec of toArray(stagedOutput)) {
        const generated = spec.account.generateOutputs(spec.position, spec.quantity, [...transactions, { inputs: [], outputs: resolved }]);
        resolved.push(...generated);
    }
    return resolved;
}

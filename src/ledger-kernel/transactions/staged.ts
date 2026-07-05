import type { Account } from "../accounts/account.js";
import { type Position, scale } from "../positions.js";
import { Transaction, type TransactionView } from "./transaction.js";
import { UTXI, type Input, type UTXOConsumption } from "./inputs.js";
import { UTXO, type Output, type UTXIConsumption } from "./outputs.js";
import type { ResidualTarget, TerminalAccount } from "../accounts/computed.js";
import type { ExchangeTarget } from "./special-edges/exchange.js";
import { Deltas } from "../accounts/delta.js";
import { toArray } from "../../utils.js";

export interface StagedInput {
    account: Account;
    position: Position;
    quantity: number | bigint;
}

export interface StagedOutput {
    account: Account;
    position: Position;
    quantity: number | bigint;
}

export interface StagedContext {
    inputs: StagedInput[];
    outputs: StagedOutput[];
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
 * Consumes `account`'s existing committed {@link UTXO} lots (via its configured
 * {@link Account.utxoDisposalMethod}) to produce `quantity` of {@link Input}s in `position`,
 * minting a fresh {@link UTXI} for any shortfall. `transactions` need not be real commit history —
 * {@link materializeInputs} passes a provisional view of everything already resolved earlier in the
 * same batch, so this never needs its own reservation bookkeeping beyond what it's handed.
 */
function generateInputsScaled(account: Account, position: Position, quantity: bigint, transactions: readonly TransactionView[]): Input[] {
    if (quantity <= 0n) throw new Error(`Cannot input a non-positive number from an account`);

    const availableUtxos: UTXO[] = Deltas.getUtxos(transactions, position, account);
    const outputTotal: bigint = availableUtxos.reduce((sum, utxo) => sum + utxo.calculateAvailable(transactions), 0n);
    const consumptionTotal: bigint = outputTotal < quantity ? outputTotal : quantity;
    const consumptionAmounts: Map<UTXO, bigint> | null = consumptionTotal !== 0n ? account.utxoDisposalMethod(availableUtxos, consumptionTotal, transactions) : null;

    let consumptionTotalVerification: bigint = 0n;
    const consumptions: UTXOConsumption[] = consumptionAmounts ? Array.from(consumptionAmounts.entries()).map(
        ([utxo, amount]: [UTXO, bigint]): UTXOConsumption => {
            consumptionTotalVerification += amount;
            return utxo.consume(amount, transactions);
        }
    ) : [];

    if (consumptionTotalVerification !== consumptionTotal) throw new Error(`The utxoDisposalMethod returned a delta of ${consumptionTotalVerification} which differs from the amount attempting to input of ${consumptionTotal}`);

    const remainder = quantity - consumptionTotal;
    if (remainder > 0n) {
        const utxi: UTXI = new UTXI(remainder, position, account);
        return [...consumptions, utxi];
    } else return consumptions;
}

/** Scales a human-readable `quantity` and delegates to {@link generateInputsScaled}. */
export function generateInputs(account: Account, position: Position, quantity: number | bigint, transactions: readonly TransactionView[]): Input[] {
    const scaledQuantity: bigint = (typeof quantity === "number") ? scale(quantity, position) : quantity;
    return generateInputsScaled(account, position, scaledQuantity, transactions);
}

/** The output-side counterpart of {@link generateInputsScaled}: settles `account`'s existing {@link UTXI} obligations first, minting a fresh {@link UTXO} for any surplus. */
function generateOutputsScaled(account: Account, position: Position, quantity: bigint, transactions: readonly TransactionView[]): Output[] {
    if (quantity <= 0n) throw new Error(`Cannot output a non-positive number from an account`);

    const availableUtxis: UTXI[] = Deltas.getUtxis(transactions, position, account);
    const inputTotal: bigint = availableUtxis.reduce((sum, utxi) => sum + utxi.calculateAvailable(transactions), 0n);
    const consumptionTotal: bigint = inputTotal < quantity ? inputTotal : quantity;
    const consumptionAmounts: Map<UTXI, bigint> | null = consumptionTotal !== 0n ? account.utxiDisposalMethod(availableUtxis, consumptionTotal, transactions) : null;

    let consumptionTotalVerification: bigint = 0n;
    const consumptions: UTXIConsumption[] = consumptionAmounts ? Array.from(consumptionAmounts.entries()).map(
        ([utxi, amount]: [UTXI, bigint]): UTXIConsumption => {
            consumptionTotalVerification += amount;
            return utxi.consume(amount, transactions);
        }
    ) : [];

    if (consumptionTotalVerification !== consumptionTotal) throw new Error(`The utxiDisposalMethod returned a delta of ${consumptionTotalVerification} which differs from the amount attempting to output of ${consumptionTotal}`);

    const remainder = quantity - consumptionTotal;
    if (remainder > 0n) {
        const utxo: UTXO = new UTXO(remainder, position, account);
        return [...consumptions, utxo];
    } else return consumptions;
}

/** Scales a human-readable `quantity` and delegates to {@link generateOutputsScaled}. */
export function generateOutputs(account: Account, position: Position, quantity: number | bigint, transactions: readonly TransactionView[]): Output[] {
    const scaledQuantity: bigint = (typeof quantity === "number") ? scale(quantity, position) : quantity;
    return generateOutputsScaled(account, position, scaledQuantity, transactions);
}

/**
 * Resolves `specs` into real {@link Input}s against `transactions`. Each spec is resolved in
 * order against `transactions` plus everything already resolved earlier in this same call, so
 * multiple specs drawing on the same account + position within one transaction can't double-draw
 * the same lot — this is the one place that reservation bookkeeping needs to exist at all. The
 * provisional `{ inputs, outputs }` view handed to {@link generateInputs} is not a real
 * {@link Transaction} (no position/verification), just the minimal {@link TransactionView} shape
 * the lot-availability scans need.
 */
export function materializeInputs(stagedInput: StagedInput | readonly StagedInput[], transactions: readonly Transaction[]): Input[] {
    const resolved: Input[] = [];
    for (const spec of toArray(stagedInput)) {
        const generated = generateInputs(spec.account, spec.position, spec.quantity, [...transactions, { inputs: resolved, outputs: [] }]);
        resolved.push(...generated);
    }
    return resolved;
}

/** The output-side counterpart of {@link materializeInputs}. */
export function materializeOutputs(stagedOutput: StagedOutput | readonly StagedOutput[], transactions: readonly Transaction[]): Output[] {
    const resolved: Output[] = [];
    for (const spec of toArray(stagedOutput)) {
        const generated = generateOutputs(spec.account, spec.position, spec.quantity, [...transactions, { inputs: [], outputs: resolved }]);
        resolved.push(...generated);
    }
    return resolved;
}

/**
 * Full materialization of a {@link StagedTransaction}: resolves `inputs` and `outputs` against
 * `transactions` via {@link materializeInputs}/{@link materializeOutputs} and constructs the
 * resulting {@link Transaction} — the single entry point for the ordinary case where both sides are
 * staged specs up front. {@link StagedExchange}/{@link StagedTerminal} call
 * {@link materializeInputs}/{@link materializeOutputs} directly instead: their other side isn't a
 * staged spec, but derived by {@link ExchangeResolution}/{@link TerminalResolution} from whichever
 * side is staged.
 */
export function materializeTransaction(staged: StagedTransaction, transactions: Transaction[]): Transaction {
    return new Transaction(materializeInputs(staged.inputs, transactions), materializeOutputs(staged.outputs, transactions), transactions);
}

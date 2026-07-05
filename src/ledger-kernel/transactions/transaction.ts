import type { Result } from "../../utils.js";
import type { Position } from "../positions.js";
import { type Input, UTXI, UTXOConsumption } from "./inputs.js";
import { type Output, UTXO, UTXIConsumption } from "./outputs.js";
import { TransactionNode } from "./node.js";

/**
 * The minimal shape lot-availability scans need — just the two arrays, not a real transaction's
 * position/verification machinery. Any {@link Transaction} satisfies it structurally, but so does a
 * lightweight `{ inputs, outputs }` view of not-yet-committed lots (see {@link materializeInputs}),
 * letting those scans see provisional reservations without a fake `Transaction` instance.
 */
export type TransactionView = Pick<Transaction, "inputs" | "outputs">;

export class Transaction extends TransactionNode {
    public position: Position;

    public inputs: Input[];
    public outputs: Output[];

    public flatten(): readonly Transaction[] { return [this]; }

    constructor(
        inputs: Input[],
        outputs: Output[],
        transactions: Transaction[]
    ) {
        super();
        const verification: Result<Position, Error> = this.verify(inputs, outputs, transactions);
        if (!verification.ok) throw verification.error;

        this.position = verification.value;

        this.inputs = inputs;
        this.outputs = outputs;
    }

    /**
     * Validates inputs and outputs before committing them to the transaction.
     * Checks position homogeneity, balance equality, and that every consumption
     * references a source with sufficient remaining availability.
     * Returns the shared {@link Position} on success.
     */
    public verify(
        inputs: Input[],
        outputs: Output[],
        transactions: Transaction[]
    ): Result<Position, Error> {
        if (inputs.length === 0 || outputs.length === 0) throw new Error("Cannot construct a transaction with no inputs or no outputs.");

        let inputsSum: bigint = 0n;
        let outputsSum: bigint = 0n;

        let position: Position | null = null;
        function verifyPosition(instancePosition: Position): void {
            if (!position) position = instancePosition;
            if (position !== instancePosition) throw new Error(`Mismatched positions included within a transaction, must all be tied to same position.`);
        }

        // Over-consumption must be checked per-source in aggregate, not per-consumption: two
        // consumptions of the same lot can each individually fit within its balance yet together
        // exceed it (double-spend within one transaction). Sum each source's draws, then compare
        // the total against the lot's availability in the committed history.
        const utxoDraws = new Map<UTXO, bigint>();
        const utxiDraws = new Map<UTXI, bigint>();

        try {
            for (const input of inputs) {
                if (input instanceof UTXOConsumption) utxoDraws.set(input.source, (utxoDraws.get(input.source) ?? 0n) + input.quantity);

                inputsSum += input.quantity;
                verifyPosition(input instanceof UTXI ? input.position : input.source.position);
            }

            for (const output of outputs) {
                if (output instanceof UTXIConsumption) utxiDraws.set(output.source, (utxiDraws.get(output.source) ?? 0n) + output.quantity);

                outputsSum += output.quantity;
                verifyPosition(output instanceof UTXO ? output.position : output.source.position);
            }

            for (const [utxo, drawn] of utxoDraws) {
                if (utxo.calculateAvailable(transactions) < drawn) throw new Error(`Attempted to construct a transaction whose UTXOConsumptions draw ${drawn} from a UTXO with only ${utxo.calculateAvailable(transactions)} available — the inputs appear to have been generated incorrectly and over-consume the lot`);
            }

            for (const [utxi, drawn] of utxiDraws) {
                if (utxi.calculateAvailable(transactions) < drawn) throw new Error(`Attempted to construct a transaction whose UTXIConsumptions draw ${drawn} from a UTXI with only ${utxi.calculateAvailable(transactions)} available — the outputs appear to have been generated incorrectly and over-consume the lot`);
            }
        } catch (err: any) { return { ok: false, error: err instanceof Error ? err : new Error(err.toString()) }; }


        if (!position) return { ok: false, error: new Error("An unexpected error occurred: verifyPosition broke an invariant.") };
        this.position = position;

        if (inputsSum !== outputsSum) return { ok: false, error: new Error(`Attempted to construct a transaction with inputs totalling ${inputsSum} and outputs totalling ${outputsSum}`) };

        return { ok: true, value: position };
    }
}

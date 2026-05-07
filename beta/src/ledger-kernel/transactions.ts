import type { Result } from "../utils.js";
import type { Position } from "./positions.js";

export class Transaction {
    public inputs: (TXI | TXOConsumption)[];
    public outputs: (TXO | TXIConsumption)[];
    public position: Position;

    constructor(inputs: (TXI | TXOConsumption)[], outputs: (TXO | TXIConsumption)[]) {
        const inputObjects: (TXI | TXOConsumption)[] = [];
        const outputObjects: (TXO | TXIConsumption)[] = [];

        let inputsSum: number = 0;
        let outputsSum: number = 0;

        if (inputs.length === 0 || outputs.length === 0) throw new Error("Cannot construct a transaction with no inputs or no outputs.");

        let txPosition: Position | null = null;
        function verifyPosition(position: Position): void {
            if (!txPosition) txPosition = position;
            if (txPosition !== position) throw new Error(`Mismatched positions included within a transaction, must all be tied to same position.`);
        }

        for (const input of inputs) {
            inputsSum += input.quantity;

            if (!(input instanceof TXI)) {
                input.source.consumptions.push(input);
                verifyPosition(input.source.position);
            } else {
                input.transaction = this;
                verifyPosition(input.position);
            }

            inputObjects.push(input);
        }

        for (const output of outputs) {
            outputsSum += output.quantity;

            if (!(output instanceof TXO)) {
                output.source.consumptions.push(output);
                verifyPosition(output.source.position);
            } else {
                output.transaction = this;
                verifyPosition(output.position);
            }

            outputObjects.push(output);
        }

        if (!txPosition) throw new Error("An unexpected error occurred: verifyPosition broke an invariant.");
        this.position = txPosition;

        if (inputsSum !== outputsSum) throw new Error(`Attempted to construct a transaction with inputs totalling ${inputsSum} and outputs totalling ${outputsSum}`);

        this.inputs = inputObjects;
        this.outputs = outputObjects;
    }

    public static exchangeLink(from: (TXO | TXIConsumption), to: (TXI | TXOConsumption)): void {
        from.exchangedInput = to;
        to.exchangedOutput = from;
    }
}

interface TXOConsumption {
    type: "TXO-consumption";
    source: TXO;
    exchangedOutput: (TXO | TXIConsumption) | undefined;
    quantity: number;
}

export class TXO {
    public consumptions: TXOConsumption[] = [];
    public exchangedInput?: (TXI | TXOConsumption);

    constructor(
        public quantity: number,
        public position: Position,
        public transaction: Transaction | null = null
    ) { }

    public calculateAvailable(): number {
        let available: number = this.quantity;
        for (const consumption of this.consumptions) available -= consumption.quantity;

        return available;
    }

    public consume(quantity: number, exchangedOutput?: (TXO | TXIConsumption)): Result<TXOConsumption, Error> {
        const available: number = this.calculateAvailable();
        if (quantity > available) return { ok: false, error: new Error(`Attempted to consume ${quantity} from a TXO that only has ${available} remaining.`) };

        const consumption: TXOConsumption = { type: "TXO-consumption", source: this, quantity, exchangedOutput };

        return { ok: true, value: consumption };
    }
}

interface TXIConsumption {
    type: "TXI-consumption";
    source: TXI;
    exchangedInput: (TXI | TXOConsumption) | undefined;
    quantity: number;
}

export class TXI {
    public consumptions: TXIConsumption[] = [];
    public exchangedOutput?: (TXO | TXIConsumption);

    constructor(
        public quantity: number,
        public position: Position,
        public transaction: Transaction | null = null
    ) { }

    public calculateAvailable(): number {
        let available: number = this.quantity;
        for (const consumption of this.consumptions) available -= consumption.quantity;

        return available;
    }

    public consume(quantity: number, exchangedInput?: (TXI | TXOConsumption)): Result<TXIConsumption, Error> {
        const available: number = this.calculateAvailable();
        if (quantity > available) return { ok: false, error: new Error(`Attempted to consume ${quantity} from a TXI that only has ${available} remaining.`) };

        const consumption: TXIConsumption = { type: "TXI-consumption", source: this, quantity, exchangedInput };

        return { ok: true, value: consumption };
    }
}

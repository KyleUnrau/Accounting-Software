import type { AccountTransactionEngine } from "../ledger.js";
import type { Position } from "../positions.js";
import type { Input, Transaction } from "../transactions.js";
import type { StagedTXOConsumption, TXI, TXOConsumption } from "./inputs.js";

export interface StagedTXO {
    stagedType: "txo";
    quantity: number;
    position: Position;
    accountEngine: AccountTransactionEngine;
}

export class TXO {
    public consumptions: TXOConsumption[] = [];
    public exchangedInput?: (TXI | TXOConsumption);
    public quantity: number;

    constructor(
        quantity: number,
        public position: Position,
        public transaction: Transaction
    ) {
        if (quantity < 0) throw new Error("The quantity of a TXO cannot be less than 0");
        this.quantity = quantity;
    }

    public calculateAvailable(): number {
        let available: number = this.quantity;
        for (const consumption of this.consumptions) available -= consumption.quantity;

        return available;
    }

    public consumeStage(quantity: number): StagedTXOConsumption {
        if (quantity < 0) throw new Error(`Attempted to consume a negative number from a TXO`);

        const available: number = this.calculateAvailable();
        if (quantity > available) throw new Error(`Attempted to consume ${quantity} from a TXO that only has ${available} remaining.`);

        const consumption: StagedTXOConsumption = {stagedType: "txo-consumption", quantity, source: this};
        return consumption;
    }
}

export interface StagedTXIConsumption {
    stagedType: "txi-consumption";
    quantity: number;
    source: TXI;
}

export class TXIConsumption {
    public quantity: number;

    constructor(
        quantity: number,
        public source: TXI,
        public transaction: Transaction,
        public exchangedInput?: (TXI | TXOConsumption)
    ) {
        if (quantity < 0) throw new Error("The quantity of a TXO cannot be less than 0");
        this.quantity = quantity;
    }
}

export interface StagedGroupedOutput {
    stagedType: "grouped-output";
    outputs: (StagedTXO | StagedTXIConsumption)[];
}

export class GroupedOutput {
    constructor(
        public transaction: Transaction,
        public outputs: (TXO | TXIConsumption)[],
        public exchangedInput?: Input
    ) {}
}

// - Output Mapping - //
export interface OutputMapping {
    txos: Map<StagedTXO, TXO>;
    txiConsumptions: Map<StagedTXIConsumption, TXIConsumption>;
    groupedOutputs: Map<StagedGroupedOutput, GroupedOutput>;
}
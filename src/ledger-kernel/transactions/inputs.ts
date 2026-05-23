import type { AccountTransactionEngine } from "../ledger.js";
import type { Position } from "../positions.js";
import type { Transaction } from "../transactions.js";
import type { Output, StagedTXIConsumption, TXIConsumption, TXO } from "./outputs.js";

export type Input = TXI | TXOConsumption | GroupedInput;
export type StagedInput = StagedTXI | StagedTXOConsumption | StagedGroupedInput;

// - TXI - //
export interface StagedTXI {
    stagedType: "txi";
    quantity: number;
    position: Position;
    accountEngine: AccountTransactionEngine;
}

export class TXI {
    public consumptions: TXIConsumption[] = [];
    public exchangedOutput?: (TXO | TXIConsumption);
    public quantity: number;

    constructor(
        quantity: number,
        public position: Position,
        public transaction: Transaction
    ) {
        if (quantity < 0) throw new Error("The quantity of a TXI cannot be less than 0");
        this.quantity = quantity;
    }

    public calculateAvailable(): number {
        let available: number = this.quantity;
        for (const consumption of this.consumptions) available -= consumption.quantity;

        return available;
    }

    public consumeStage(quantity: number): StagedTXIConsumption {
        if (quantity < 0) throw new Error(`Attempted to consume a negative number from a TXI`);

        const available: number = this.calculateAvailable();
        if (quantity > available) throw new Error(`Attempted to consume ${quantity} from a TXI that only has ${available} remaining.`);

        const consumption: StagedTXIConsumption = {stagedType: "txi-consumption", quantity, source: this};
        return consumption;
    }
}

// - TXO Consumption - //
export interface StagedTXOConsumption {
    stagedType: "txo-consumption";
    source: TXO;
    quantity: number;
}

export class TXOConsumption {
    public quantity: number;

    constructor(
        quantity: number,
        public source: TXO,
        public transaction: Transaction,
        public exchangedOutput?: (TXO | TXIConsumption)
    ) {
        if (quantity < 0) throw new Error("The quantity of a TXO cannot be less than 0");
        this.quantity = quantity;
    }
}

// - Grouped Input - //
export interface StagedGroupedInput {
    stagedType: "grouped-input";
    inputs: (StagedTXI | StagedTXOConsumption)[];
}

export class GroupedInput {
    constructor(
        public transaction: Transaction,
        public inputs: (TXI | TXOConsumption)[],
        public exchangedOutput?: Output
    ) {}
}

// - Input Mapping - //
export interface InputMapping {
    txis: Map<StagedTXI, TXI>;
    txoConsumptions: Map<StagedTXOConsumption, TXOConsumption>;
    groupedInputs: Map<StagedGroupedInput, GroupedInput>;
}
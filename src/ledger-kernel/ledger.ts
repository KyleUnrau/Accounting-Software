import type { Position } from "./positions.js";
import type { Result } from "../utils.js";
import { Transaction } from "./transactions.js";
import type { AccountFolder } from "./accounts.js";
import type { Input } from "./transactions/inputs.js";
import type { Output } from "./transactions/outputs.js";
import { ExchangedTXI, ExchangedTXO } from "./transactions/exchange.js";

export enum Orientation {
    Positive = 1,
    Negative = -1
}

export class Ledger {
    public transactions: Transaction[] = [];

    constructor(
        public netAssets: AccountFolder,
        public equity: AccountFolder
    ) {}

    public newTransaction(stagedInputs: Input[], stagedOutputs: Output[]): Transaction {
        const transaction = new Transaction(stagedInputs, stagedOutputs, this.transactions);
        this.transactions.push(transaction);
        return transaction;
    }

    public verify(): Result<undefined, Error> {
        const rootBalances: Map<Position, number> = this.getRootBalances();

        for (const [position, rootBalance] of rootBalances) {
            if (Math.abs(rootBalance) > Number.EPSILON) return {ok: false, error: new Error(`Ledger invalid, root balance for ${position.name} calculated as ${rootBalance} instead of 0`)};
        }

        return {ok: true, value: undefined};
    }

    public getRootBalances(): Map<Position, number> {
        const rootBalances: Map<Position, number> = new Map();

        for (const [position, rootBalance] of this.netAssets.getRootBalances(this.transactions))
            rootBalances.set(position, rootBalance + (rootBalances.get(position) ?? 0));
        for (const [position, rootBalance] of this.equity.getRootBalances(this.transactions))
            rootBalances.set(position, rootBalance + (rootBalances.get(position) ?? 0));

        for (const tx of this.transactions) {
            for (const output of tx.outputs) {
                if (output instanceof ExchangedTXO) {
                    const available = output.calculateAvailable(this.transactions);
                    if (available !== 0) rootBalances.set(output.position, (rootBalances.get(output.position) ?? 0) + available);
                }
            }
            for (const input of tx.inputs) {
                if (input instanceof ExchangedTXI) {
                    const available = input.calculateAvailable(this.transactions);
                    if (available !== 0) rootBalances.set(input.position, (rootBalances.get(input.position) ?? 0) - available);
                }
            }
        }

        return rootBalances;
    }
}

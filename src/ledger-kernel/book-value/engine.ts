import { ExchangedTXI, ResidualTXI } from "../transactions/exchange.js";
import { TXI, TXOConsumption, type Input } from "../transactions/inputs.js";
import { TXO } from "../transactions/outputs.js";
import type { Transaction } from "../transactions.js";
import type { BasisPath, ExchangePath, OriginPath, ResidualPath } from "./types.js";

export type { BasisPath, ExchangePath, OriginPath, ResidualPath } from "./types.js";

export class BookValueEngine {
    constructor(private readonly transactions: Transaction[]) {}

    public compute(txo: TXO, quantity: number): BasisPath[] {
        if (quantity <= 0) throw new Error(`quantity must be positive, got ${quantity}`);
        if (quantity > txo.quantity) throw new Error(`quantity ${quantity} exceeds txo.quantity ${txo.quantity}`);
        return this.traceTXO(txo, quantity, new Set<TXO>());
    }

    private traceTXO(txo: TXO, quantity: number, visited: Set<TXO>): BasisPath[] {
        if (visited.has(txo)) throw new Error(`Cycle detected: TXO encountered twice in traversal path`);

        const nextVisited = new Set(visited);
        nextVisited.add(txo);

        const producingTx = this.findProducingTransaction(txo);
        if (!producingTx) throw new Error(`TXO has no producing transaction — ledger invariant violated`);

        const totalOutputQty = producingTx.outputs.reduce((sum, out) => sum + out.quantity, 0);
        const inputFraction = quantity / totalOutputQty;

        const result: BasisPath[] = [];
        for (const input of producingTx.inputs) {
            const attributedQty = input.quantity * inputFraction;
            if (attributedQty < Number.EPSILON) continue;
            result.push(...this.traceInput(input, attributedQty, nextVisited));
        }
        return result;
    }

    private traceInput(input: Input, quantity: number, visited: Set<TXO>): BasisPath[] {
        if (input instanceof TXOConsumption) {
            return this.traceTXO(input.source, quantity, visited);
        }

        if (input instanceof ExchangedTXI) {
            const ex = input.exchange;
            const fromQty = quantity * (ex.from.quantity / ex.to.quantity);
            const basis = this.traceTXO(ex.from, fromQty, visited);
            return [{ type: "exchange", exchange: ex, quantity, fromQuantity: fromQty, basis } satisfies ExchangePath];
        }

        if (input instanceof ResidualTXI) {
            const ex = input.exchange;
            const fromQty = quantity * (ex.from.quantity / ex.to.quantity);
            const basis = this.traceTXO(ex.from, fromQty, visited);
            return [{ type: "residual", exchange: ex, quantity, fromQuantity: fromQty, basis } satisfies ResidualPath];
        }

        if (input instanceof TXI) {
            return [{ type: "origin", quantity, position: input.position } satisfies OriginPath];
        }

        throw new Error(`Unknown input type encountered: ${(input as { type?: unknown }).type}`);
    }

    private findProducingTransaction(txo: TXO): Transaction | undefined {
        for (const tx of this.transactions) {
            for (const output of tx.outputs) {
                if (output === txo) return tx;
            }
        }
        return undefined;
    }
}

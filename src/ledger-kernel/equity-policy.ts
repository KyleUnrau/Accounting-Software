import type { Exchange, ReverseExchange } from "./transactions/exchange.js";
import { TXOConsumption } from "./transactions/inputs.js";
import { TXO } from "./transactions/outputs.js";
import type { Transaction } from "./transactions.js";
import type { Position } from "./positions.js";
import { BookValueEngine } from "./book-value/engine.js";
import type { BasisPath, ExchangePath, ResidualPath } from "./book-value/types.js";

type RecaptureableNode = {
    exchange: Exchange;
    toSideQuantity: number;
    fromQuantity: number;
};

export type RecaptureResolution = {
    recaptures: ReverseExchange[];
    totalCostBasis: number;
    residualQuantity: number;
    newExchangeToSideQuantity: number;
    newExchangeFromQuantity: number;
};

export function collectRecaptureableNodes(basis: BasisPath[], targetPosition: Position): RecaptureableNode[] {
    const result: RecaptureableNode[] = [];

    for (const path of basis) {
        if (path.type === "origin") continue;

        if (path.type === "exchange" && path.exchange.from.position === targetPosition) {
            result.push({ exchange: path.exchange, toSideQuantity: path.quantity, fromQuantity: path.fromQuantity });
        } else if (path.type === "exchange") {
            result.push(...collectRecaptureableNodes(path.basis, targetPosition));
        } else if (path.type === "residual") {
            if (path.exchange.from.position !== targetPosition) {
                result.push(...collectRecaptureableNodes(path.basis, targetPosition));
            }
        }
    }

    return result;
}

export function groupRecapturesByExchange(nodes: RecaptureableNode[]): Map<Exchange, { toSideQuantity: number; fromQuantity: number }> {
    const grouped = new Map<Exchange, { toSideQuantity: number; fromQuantity: number }>();

    for (const node of nodes) {
        const existing = grouped.get(node.exchange) ?? { toSideQuantity: 0, fromQuantity: 0 };
        grouped.set(node.exchange, {
            toSideQuantity: existing.toSideQuantity + node.toSideQuantity,
            fromQuantity: existing.fromQuantity + node.fromQuantity
        });
    }

    return grouped;
}

export function computeRecaptureResolution(
    consumedTXOs: { source: TXO; quantity: number }[],
    targetPosition: Position,
    totalActualReceived: number,
    engine: BookValueEngine,
    transactions: Transaction[]
): RecaptureResolution {
    const totalConsumed = consumedTXOs.reduce((sum, c) => sum + c.quantity, 0);

    const allBasis: BasisPath[] = consumedTXOs.flatMap(({ source, quantity }) => engine.compute(source, quantity));

    const nodes = collectRecaptureableNodes(allBasis, targetPosition);
    const grouped = groupRecapturesByExchange(nodes);

    const recaptures: ReverseExchange[] = [];
    let totalCostBasis = 0;
    let totalRecapturedToSide = 0;

    for (const [exchange, { toSideQuantity, fromQuantity }] of grouped) {
        recaptures.push(exchange.recapture(toSideQuantity, transactions));
        totalCostBasis += fromQuantity;
        totalRecapturedToSide += toSideQuantity;
    }

    const totalActualForRecaptured = totalConsumed > 0
        ? totalActualReceived * (totalRecapturedToSide / totalConsumed)
        : 0;

    return {
        recaptures,
        totalCostBasis,
        residualQuantity: totalActualForRecaptured - totalCostBasis,
        newExchangeToSideQuantity: totalConsumed - totalRecapturedToSide,
        newExchangeFromQuantity: totalActualReceived - totalActualForRecaptured
    };
}

export function consumedTXOsFromInputs(inputs: (TXOConsumption | unknown)[]): { source: TXO; quantity: number }[] {
    return inputs.filter((i): i is TXOConsumption => i instanceof TXOConsumption)
        .map(c => ({ source: c.source, quantity: c.quantity }));
}

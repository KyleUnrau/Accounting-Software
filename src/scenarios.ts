import { ProvenanceEngine } from "./equity-policy/provenance/engine.js";
import { AccountFolder } from "./ledger-kernel/accounts/folder.js";
import { fifo } from "./ledger-kernel/disposal-methods/basic-fifo.js";
import { Ledger, Orientation } from "./ledger-kernel/ledger.js";
import type { LedgerEvent } from "./ledger-kernel/event.js";
import type { Position } from "./ledger-kernel/positions.js";
import type { UTXI } from "./ledger-kernel/transactions/inputs.js";
import type { UTXO } from "./ledger-kernel/transactions/outputs.js";

/**
 * A self-contained, serialization-ready handle on a ledger for the explorer. Bundles the
 * {@link Ledger} (which owns the transaction history) with the live {@link ProvenanceEngine}
 * and the list of {@link Position}s that appear in the book. The server reads — never mutates —
 * this view, and builds fresh per-slice engines for as-of basis queries.
 */
export interface LedgerView {
    ledger: Ledger;
    engine: ProvenanceEngine;
    positions: Position[];
    events: LedgerEvent[];
}

export namespace ScenarioLedger {
    interface Positions {
        a: Position;
        b: Position;
        c: Position;
    }

    export const positions: Positions = {
        a: { name: "Position A (Currency)", decimals: 2 },
        b: { name: "Position B (Currency)", decimals: 2 },
        c: { name: "Position C (Inventory)", decimals: 0 }
    }

    function generateAccounts() {
        const netAssets = new AccountFolder("Net Assets", Orientation.Positive);
        const equity = new AccountFolder("Net Worth", Orientation.Negative);

        const assets = netAssets.addFolder("Assets", Orientation.Positive);
        const cash = assets.addAccount("Cash", Orientation.Positive, fifo<UTXO>, fifo<UTXI>);
        const inventory = assets.addAccount("Inventory", Orientation.Positive, fifo<UTXO>, fifo<UTXI>);

        const liabilities = netAssets.addFolder("Liabilities", Orientation.Negative);
        const accountsPayable = liabilities.addAccount("Accounts Payable", Orientation.Positive, fifo<UTXO>, fifo<UTXI>);

        const openingBalance = equity.addAccount("Opening Balance", Orientation.Positive, fifo<UTXO>, fifo<UTXI>);
        const netCapitalGains = equity.addFolder({positive: "Net Capital Gains", negative: "Net Capital Loss"}, Orientation.Positive);
        
        const capitalGains = netCapitalGains.addFolder("Capital Gains", Orientation.Positive);
        const gainsFromA = capitalGains.addResidualAccount("Capital Gains from Disposition of A", Orientation.Positive);
        const gainsFromB = capitalGains.addResidualAccount("Capital Gains from Disposition of B", Orientation.Positive)

        const capitalLosses = netCapitalGains.addFolder("Capital Loss", Orientation.Negative);
        const lossesFromA = capitalLosses.addTerminalAccount("Capital Loss from Disposition of A", Orientation.Positive);
        const lossesFromB = capitalLosses.addTerminalAccount("Capital Loss from Disposition of B", Orientation.Positive);

        const netTransfers = equity.addFolder("Net Transfers", Orientation.Positive);

        const transfersFrom = netTransfers.addFolder("Transfers From", Orientation.Positive);
        const fromA = transfersFrom.addExchangeAccount("Transfers from A", Orientation.Positive);
        const fromB = transfersFrom.addExchangeAccount("Transfers from B", Orientation.Positive);

        const transfersTo = netTransfers.addFolder("Transfers To", Orientation.Negative);
        const toA = transfersTo.addExchangeAccount("Transfers to A", Orientation.Positive);
        const toB = transfersTo.addExchangeAccount("Transfers to B", Orientation.Positive);
        const toC = transfersTo.addExchangeAccount("Transfers to C", Orientation.Positive);

        const netIncome = equity.addFolder("Net Income", Orientation.Positive);
        const revenues = netIncome.addFolder("Revenues", Orientation.Positive);
        const inventoryProfit = revenues.addResidualAccount("Profit from Disposition of Inventory", Orientation.Positive);

        const expenses = netIncome.addFolder("Expenses", Orientation.Negative);
        const salesTax = expenses.addTerminalAccount("Sales Tax", Orientation.Positive);
        const exchangeExpense = expenses.addTerminalAccount("Exchange Expense", Orientation.Positive);
        const rentExpense = expenses.addTerminalAccount("Rent Expense", Orientation.Positive);
        const inventoryLoss = expenses.addTerminalAccount("Losses from the Disposition of Inventory", Orientation.Positive);
        const spoilageExpense = expenses.addTerminalAccount("Spoilage Expense", Orientation.Positive);

        return {
            netAssets,
            equity,

            assets,
            cash,
            inventory,

            liabilities,
            accountsPayable,

            openingBalance,
            netCapitalGains,

            capitalGains,
            gainsFromA,
            gainsFromB,

            capitalLosses,
            lossesFromA,
            lossesFromB,

            residualA: {gain: gainsFromA, loss: lossesFromA},
            residualB: {gain: gainsFromB, loss: lossesFromB},

            netTransfers,

            transfersFrom,
            fromA,
            fromB,

            transfersTo,
            toA,
            toB,
            toC,

            netIncome,
            revenues,
            inventoryProfit,

            expenses,
            salesTax,
            exchangeExpense,
            rentExpense,
            inventoryLoss,
            spoilageExpense
        };
    }

    export const accounts = generateAccounts();

    export const ledger: Ledger = new Ledger(accounts.netAssets, accounts.equity);
    export const engine = ledger.engine;

    export const events: Record<string, () => any> = {
        event0: (): LedgerEvent => ledger.newTransaction({
            inputs: {position: positions.a, account: accounts.openingBalance, quantity: 1000},
            outputs: {position: positions.a, account: accounts.cash, quantity: 1000}
        }),
        event1: (): LedgerEvent => ledger.newExchange({
            fromInputs: {position: positions.a, account: accounts.cash, quantity: 500},
            toOutputs: {position: positions.b, account: accounts.cash, quantity: 250},
            residual: accounts.residualA,
            exchange: {from: accounts.toB, to: accounts.fromA}
        }),
        event2: (): LedgerEvent => {
            const event = ledger.beginEvent();
            event.stageTerminal({
                inputs: {position: positions.b, account: accounts.cash, quantity: 50},
                account: accounts.exchangeExpense
            });
            event.stageExchange({
                fromInputs: {position: positions.b, account: accounts.cash, quantity: 200},
                toOutputs: {position: positions.c, account: accounts.inventory, quantity: 2000},
                residual: accounts.residualB,
                exchange: {from: accounts.toC, to: accounts.fromB}
            });
            return event.register();
        }
    }

    export function buildSampleLedger(): LedgerView {
        const returnEvents: any[] = [];

        for (const event of Object.values(events)) returnEvents.push(event());

        return {
            ledger: ledger,
            engine: engine,
            positions: Object.values(positions),
            events: returnEvents
        };
    }
}
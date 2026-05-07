import type { Position } from "./ledger-kernel/positions.js";
import { TXO, TXI, Transaction } from "./ledger-kernel/transactions.js";
import { runCLI } from "./utils.js";

const cad: Position = {name: "Canadian Dollars"};
const usd: Position = {name: "United States Dollars"};

const output = new TXO(1000, cad);
const input = new TXI(1000, cad);

const transaction: Transaction = new Transaction(
    [input],
    [output]
);

const consumed = output.consume(525);

const exchangeExpense = new TXO(25, cad);
const transferToUsd = new TXO(500, cad);

const newTransaction: Transaction = new Transaction(
    [consumed],
    [exchangeExpense, transferToUsd]
);

const transfersFromCad = new TXI(375, usd);
Transaction.exchangeLink(transferToUsd, transfersFromCad);
const usdCash = new TXO(375, usd);

const nextTransaction: Transaction = new Transaction(
    [transfersFromCad],
    [usdCash]
);

const usdConsumed = usdCash.consume(6.55);

const consumedTransfersFromCad = transfersFromCad.consume(6.55);

const expenseUsd = new Transaction([usdConsumed], [consumedTransfersFromCad]);

const consumedtransferToUsd = transferToUsd.consume(8.73);
Transaction.exchangeLink(consumedTransfersFromCad, consumedtransferToUsd);

const gstExpense = new TXO(8.73, cad);
const gstTransaction = new Transaction([consumedtransferToUsd], [gstExpense]);

runCLI({
    cad,
    usd,
    output,
    input,
    transaction,
    consumed,
    exchangeExpense,
    transfersFromCad,
    newTransaction,
    nextTransaction,
    usdConsumed,
    consumedTransfersFromCad,
    expenseUsd,
    consumedtransferToUsd,
    gstExpense,
    gstTransaction
});
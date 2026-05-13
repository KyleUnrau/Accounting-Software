import { clear } from "node:console";

import { dump, runCLI, write } from "./utils.js";
import { fifo } from "./ledger-kernel/disposal-methods/basic-fifo.js";
import { AccountTransactionEngine } from "./ledger-kernel/ledger.js";
import type { Position } from "./ledger-kernel/positions.js";
import { TXO } from "./ledger-kernel/transactions/outputs.js";
import { TXI } from "./ledger-kernel/transactions/inputs.js";
import { Transaction } from "./ledger-kernel/transactions.js";

const cad: Position = { name: "Canadian Dollars" };
const usd: Position = { name: "United States Dollars" };

const openingBalance: AccountTransactionEngine = new AccountTransactionEngine(cad, fifo<TXO>, fifo<TXI>);
const cadCash: AccountTransactionEngine = new AccountTransactionEngine(cad, fifo<TXO>, fifo<TXI>);
const exchangeExpense: AccountTransactionEngine = new AccountTransactionEngine(cad, fifo<TXO>, fifo<TXI>);
const transfersToUSD: AccountTransactionEngine = new AccountTransactionEngine(cad, fifo<TXO>, fifo<TXI>);

const transfersFromCAD: AccountTransactionEngine = new AccountTransactionEngine(usd, fifo<TXO>, fifo<TXI>);
const usdCash: AccountTransactionEngine = new AccountTransactionEngine(usd, fifo<TXO>, fifo<TXI>);

const entry1 = openingBalance.stageInput(1000);
const entry2 = cadCash.stageOutput(1000);

const trans1 = new Transaction([entry1], [entry2]);

const entry3 = cadCash.stageInput(525);
const entry4 = exchangeExpense.stageOutput(25);
const entry5 = transfersToUSD.stageOutput(500);

const entry6 = transfersFromCAD.stageInput(375);
const entry7 = usdCash.stageOutput(375);

const trans2cad = new Transaction([entry3], [entry4, entry5]);
const trans2usd = new Transaction([entry6], [entry7]);

Transaction.exchangeLink(trans2cad.getOutputFromStaged(entry5), trans2usd.getInputFromStaged(entry6));

runCLI({
    cad,
    usd,
    openingBalance,
    cadCash,
    exchangeExpense, 
    transfersToUSD,
    transfersFromCAD,
    usdCash,
    entry1,
    entry2,
    trans1,
    entry3,
    entry4,
    entry5,
    entry6,
    entry7,
    trans2cad,
    trans2usd,
    fifo,
    clear,
    dump,
    write,
    Transaction,
    TXO,
    TXI
});
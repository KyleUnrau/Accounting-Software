import { clear } from "node:console";

import { dump, runCLI, write } from "./utils.js";
import { fifo } from "./ledger-kernel/disposal-methods/basic-fifo.js";
import { Account, AccountFolder, Ledger, Orientation } from "./ledger-kernel/ledger.js";
import { TXO } from "./ledger-kernel/transactions/outputs.js";
import { TXI } from "./ledger-kernel/transactions/inputs.js";
import { Transaction } from "./ledger-kernel/transactions.js";
import type { Position } from "./ledger-kernel/positions.js";

const cad: Position = { name: "Canadian Dollars" };
const usd: Position = { name: "United States Dollars" };

const netAssets: AccountFolder = new AccountFolder("Net Assets", Orientation.Positive);
const netWorth: AccountFolder = new AccountFolder("Net Worth", Orientation.Negative);

const ledger: Ledger = new Ledger(netAssets, netWorth);

const assets: AccountFolder = netAssets.addFolder("Assets", Orientation.Positive);
const liabilities: AccountFolder = netAssets.addFolder("Liabilities", Orientation.Negative);;

const currentAssets: AccountFolder = assets.addFolder("Current Assets", Orientation.Positive);

const cash: Account = currentAssets.addAccount("Cash", Orientation.Positive, fifo<TXO>, fifo<TXI>);
const openingBalance: Account = netWorth.addAccount("Opening Balance", Orientation.Positive, fifo<TXO>, fifo<TXI>);

const entry1 = cash.getEngine(cad).stageOutput(1000);
const entry2 = openingBalance.getEngine(cad).stageInput(1000);

const transaction = new Transaction([entry2], [entry1]);

/*
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
*/

runCLI({
    cad,
    usd,
    netAssets,
    netWorth,
    ledger,
    assets,
    liabilities,
    currentAssets,
    cash,
    openingBalance,
    entry1,
    entry2,
    transaction,
    fifo,
    clear,
    dump,
    write,
    Account,
    AccountFolder,
    Ledger,
    Orientation,
    Transaction,
    TXO,
    TXI,
    runCLI
});
import { clear } from "node:console";

import { dump, runCLI, write } from "./utils.js";
import { fifo } from "./ledger-kernel/disposal-methods/basic-fifo.js";
import { TXO } from "./ledger-kernel/transactions/outputs.js";
import { TXI, TXOConsumption } from "./ledger-kernel/transactions/inputs.js";
import { Transaction } from "./ledger-kernel/transactions.js";
import { Ledger, Orientation } from "./ledger-kernel/ledger.js";
import { Account, AccountFolder } from "./ledger-kernel/accounts.js";
import type { Position } from "./ledger-kernel/positions.js";
import { Exchange } from "./ledger-kernel/transactions/exchange.js";
import { BookValueEngine } from "./ledger-kernel/book-value/engine.js";
import { computeRecaptureResolution, consumedTXOsFromInputs } from "./ledger-kernel/equity-policy.js";

// Positions
const btc: Position = { name: "Bitcoin" };
const cad: Position = { name: "Canadian Dollars" };
const usd: Position = { name: "United States Dollars" };

// Chart of accounts
const netAssets: AccountFolder = new AccountFolder("Net Assets", Orientation.Positive);
const netWorth: AccountFolder = new AccountFolder("Net Worth", Orientation.Negative);
const ledger: Ledger = new Ledger(netAssets, netWorth);

const assets: AccountFolder = netAssets.addFolder("Assets", Orientation.Positive);
const currentAssets: AccountFolder = assets.addFolder("Current Assets", Orientation.Positive);
const netIncome: AccountFolder = netWorth.addFolder("Net Income", Orientation.Positive);
const expenses: AccountFolder = netIncome.addFolder("Expenses", Orientation.Negative);

const cash: Account = currentAssets.addAccount("Cash", Orientation.Positive, fifo<TXO>, fifo<TXI>);
const wallet: Account = currentAssets.addAccount("Cryptocurrency Wallet", Orientation.Positive, fifo<TXO>, fifo<TXI>);
const openingBalance: Account = netWorth.addAccount("Opening Balance", Orientation.Positive, fifo<TXO>, fifo<TXI>);
const exchangeExpense: Account = expenses.addAccount("Exchange Expense", Orientation.Positive, fifo<TXO>, fifo<TXI>);
const capitalGains: Account = netIncome.addAccount("Capital Gains", Orientation.Positive, fifo<TXO>, fifo<TXI>);

// ─── Phase 1: Opening balance 0.02 BTC ───────────────────────────────────────
const ob0Inputs = openingBalance.generateInputs(btc, 0.02, ledger.transactions);
const ob0Outputs = wallet.generateOutputs(btc, 0.02, ledger.transactions);
ledger.newTransaction(ob0Inputs, ob0Outputs); // Tx #0

// ─── Phase 2: Exchange 0.01 BTC → 1000 CAD ────────────────────────────────────
const exchange0 = new Exchange({ quantity: 0.01, position: btc }, { quantity: 1000, position: cad });

const btcOutInputs = wallet.generateInputs(btc, 0.01, ledger.transactions);
ledger.newTransaction(btcOutInputs, [exchange0.from]); // Tx #1

const cadInOutputs = cash.generateOutputs(cad, 1000, ledger.transactions);
ledger.newTransaction([exchange0.to], cadInOutputs); // Tx #2

// ─── Phase 3: 525 CAD → Exchange#1 (500 CAD→375 USD) + partial Exchange#0 fee ─
const exchange1 = new Exchange({ quantity: 500, position: cad }, { quantity: 375, position: usd });
const rev0fee = exchange0.recapture(25, ledger.transactions); // 25 CAD → 0.00025 BTC

const cad525Inputs = cash.generateInputs(cad, 525, ledger.transactions);
ledger.newTransaction(cad525Inputs, [exchange1.from, rev0fee.from]); // Tx #3 (CAD)

ledger.newTransaction([rev0fee.to], exchangeExpense.generateOutputs(btc, 0.00025, ledger.transactions)); // Tx #4 (BTC)

const usdInOutputs = cash.generateOutputs(usd, 375, ledger.transactions);
ledger.newTransaction([exchange1.to], usdInOutputs); // Tx #5 (USD)

// ─── Phase 4: 375 USD → CAD via equity policy ────────────────────────────────
// Basis of the 375 USD traces through Exchange#1 (from.position = CAD).
// Cost basis = 500 CAD.  Actual received may be above (gain) or below (loss):
//   gain  → ResidualTXI into capitalGains (income, tagged to exchange0's BTC rate)
//   loss  → ResidualTXO out of capitalGains (expense, tagged to exchange0's BTC rate)

const engine = new BookValueEngine(ledger.transactions);

const actualCadReceived = 450;  // change to e.g. 550 for a gain scenario
const usdInputs = cash.generateInputs(usd, 375, ledger.transactions);
const usdResolution = computeRecaptureResolution(
    consumedTXOsFromInputs(usdInputs),
    cad,
    actualCadReceived,
    engine,
    ledger.transactions
);
// usdResolution.recaptures[0]   = exchange1.recapture(375) → 500 CAD at original rate
// usdResolution.residualQuantity = actualCadReceived − 500  (positive = gain, negative = loss)

const cadResidualTXI = usdResolution.residualQuantity > 0
    ? capitalGains.generateResidualInput(cad, usdResolution.residualQuantity, exchange0)
    : null;
const cadResidualTXO = usdResolution.residualQuantity < 0
    ? capitalGains.generateResidualOutput(cad, -usdResolution.residualQuantity, exchange0)
    : null;

ledger.newTransaction(usdInputs, [usdResolution.recaptures[0]!.from]); // Tx #6 (USD)
ledger.newTransaction(
    [usdResolution.recaptures[0]!.to, ...(cadResidualTXI ? [cadResidualTXI] : [])],
    [...(cadResidualTXO ? [cadResidualTXO] : []), ...cash.generateOutputs(cad, actualCadReceived, ledger.transactions)]
); // Tx #7 (CAD)

// ─── Phase 5: Add 2000 CAD opening balance ─────────────────────────────────────
const ob1Inputs = openingBalance.generateInputs(cad, 2000, ledger.transactions);
const ob1Outputs = cash.generateOutputs(cad, 2000, ledger.transactions);
ledger.newTransaction(ob1Inputs, ob1Outputs); // Tx #8 — cash now has 550 + 2000 = 2550 CAD

// ─── Phase 6: 2550 CAD → 0.02805 BTC via equity policy with proration ─────────
// FIFO consumes: TXO(1000 CAD)[475 rem], TXO(550 CAD)[550], TXO(2000 CAD)[1525].
//
// ExchangePath-only recapture (ResidualPath = already-recognized gain, not reclaimable from exchange):
//   TXO(1000) 475 → ExchangePath(exchange0, qty=475, from=0.00475)
//   TXO(550)  550 → ExchangePath(exchange0, qty=500) + ResidualPath(exchange0, qty=50) → 500 recapturable only
//   TXO(2000) 1525 → OriginPath(1525)
//   Grouped: exchange0 toSideQty=975, fromQty=0.00975
//   exchange0.to.available = 1000 − 25 = 975 → recapture(975) exactly exhausts it ✓
//
// At 0.000011 BTC/CAD (10% better than exchange0's 0.00001):
//   Total BTC = 2550 × 0.000011 = 0.02805
//   Actual for 975 CAD = 0.02805 × (975/2550) = 0.010725 BTC
//   Gain = 0.010725 − 0.00975 = 0.000975 BTC
//   New exchange = 1575 CAD (1525 origin + 50 residual gain treated as new money) → 0.017325 BTC

const totalBtcReceived = 0.02805;
const cadInputs = cash.generateInputs(cad, 2550, ledger.transactions);
const cadResolution = computeRecaptureResolution(
    consumedTXOsFromInputs(cadInputs),
    btc,
    totalBtcReceived,
    engine,
    ledger.transactions
);
// cadResolution.recaptures[0]             = exchange0.recapture(toSideQty) → fromQty BTC at original rate
// cadResolution.residualQuantity          = actualForRecaptured − fromQty  (positive = gain, negative = loss)
// cadResolution.newExchangeToSideQuantity = remaining CAD (not exchange-attributed)
// cadResolution.newExchangeFromQuantity   = BTC for the new exchange portion

const exchange2 = new Exchange(
    { quantity: cadResolution.newExchangeToSideQuantity, position: cad },
    { quantity: cadResolution.newExchangeFromQuantity, position: btc }
);

const btcResidualTXI = cadResolution.residualQuantity > 0
    ? capitalGains.generateResidualInput(btc, cadResolution.residualQuantity, exchange0)
    : null;
const btcResidualTXO = cadResolution.residualQuantity < 0
    ? capitalGains.generateResidualOutput(btc, -cadResolution.residualQuantity, exchange0)
    : null;

ledger.newTransaction(
    cadInputs,
    [exchange2.from, cadResolution.recaptures[0]!.from] // Tx #9 (CAD)
);
ledger.newTransaction(
    [cadResolution.recaptures[0]!.to, exchange2.to, ...(btcResidualTXI ? [btcResidualTXI] : [])],
    [...(btcResidualTXO ? [btcResidualTXO] : []), ...wallet.generateOutputs(btc, totalBtcReceived, ledger.transactions)]
); // Tx #10 (BTC)

// ─── Verify ───────────────────────────────────────────────────────────────────
const verification = ledger.verify();
if (!verification.ok) throw verification.error;

runCLI({
    btc,
    cad,
    usd,
    netAssets,
    netWorth,
    ledger,
    assets,
    currentAssets,
    netIncome,
    expenses,
    cash,
    wallet,
    openingBalance,
    exchangeExpense,
    capitalGains,
    ob0Inputs,
    ob0Outputs,
    exchange0,
    btcOutInputs,
    cadInOutputs,
    exchange1,
    rev0fee,
    cad525Inputs,
    usdInOutputs,
    usdResolution,
    cadResidualTXI,
    cadResidualTXO,
    ob1Inputs,
    ob1Outputs,
    totalBtcReceived,
    cadInputs,
    cadResolution,
    exchange2,
    btcResidualTXI,
    btcResidualTXO,
    engine,
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
    TXOConsumption,
    Exchange,
    BookValueEngine,
    computeRecaptureResolution,
    consumedTXOsFromInputs,
    runCLI
});

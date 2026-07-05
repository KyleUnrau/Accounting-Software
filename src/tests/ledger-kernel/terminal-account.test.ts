import { test } from "node:test";
import assert from "node:assert/strict";

import { TerminalUTXO } from "../../ledger-kernel/transactions/special-edges/terminal.js";
import { TerminalAccount } from "../../ledger-kernel/accounts/computed.js";
import { Account } from "../../ledger-kernel/accounts/account.js";
import { makeFixture, openInto } from "../utils/ledger-fixture.js";
import { Deltas } from "../../ledger-kernel/accounts/delta.js";

// A terminal settlement record must never become spendable inventory. These tests pin the
// *structural* guarantees (not merely convention) that keep terminal value final.

test("TERM1: a TerminalUTXO cannot be consumed — consume() throws", () => {
    const f = makeFixture();
    const terminal = f.exchangeExpense.recognize(100n, f.cad);
    assert.ok(terminal instanceof TerminalUTXO);
    assert.throws(() => terminal.consume(), /terminal settlement record and cannot be consumed/);
});

test("TERM2: a TerminalAccount is not an ordinary Account and exposes no source capability", () => {
    const f = makeFixture();
    // It is a computed sink, not an inventory Account, so it can never be drawn from.
    assert.equal(f.exchangeExpense instanceof Account, false, "a TerminalAccount is not an Account");
    assert.equal(typeof (f.exchangeExpense as unknown as { generateInputs?: unknown }).generateInputs, "undefined", "no generateInputs — cannot be a transaction source");
});

test("TERM3: an expensed terminal record is committed and counts toward balance, yet lives in no consumable lot store", () => {
    const f = makeFixture();
    openInto(f, f.cash, f.cad, 1000);

    const event = f.ledger.beginEvent();
    event.stageTerminal({
        inputs: { account: f.cash, position: f.cad, quantity: 200 },
        account: f.exchangeExpense
    });
    event.register();

    assert.ok(f.ledger.verify().ok, "ledger verifies after expensing into a terminal account");
    assert.equal(f.exchangeExpense.getBalance(f.cad, f.ledger.transactions), 200, "the terminal record counts toward the account balance");

    // The terminal records are real transaction outputs, but no ordinary Account's `.account` back-reference
    // ever points to a TerminalUTXO — no FIFO/disposal/selection path can ever reach them.
    for (const account of [...f.ledger.netAssets.getAccounts(), ...f.ledger.equity.getAccounts()])
        for (const position of [f.cad, f.usd, f.oranges, f.btc])
            for (const utxo of Deltas.getUtxos(f.ledger.transactions, position, account))
                assert.equal(utxo instanceof TerminalUTXO, false, "no TerminalUTXO is ever held as a spendable lot");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFixture, openInto } from "../utils/ledger-fixture.js";
import { Transaction } from "../../ledger-kernel/transactions/transaction.js";
import { generateInputs, generateOutputs } from "../../ledger-kernel/transactions/staged.js";

test("generated lots only affect balances once their transaction is committed", () => {
    const f = makeFixture();
    openInto(f, f.cash, f.cad, 1000);

    assert.ok(f.ledger.verify().ok);
    assert.equal(f.cash.getBalance(f.cad, f.ledger.transactions), 1000);

    // Generate a 750 CAD receipt into cash WITHOUT building or committing a transaction for it.
    const receipt = generateOutputs(f.cash, f.cad, 750, f.ledger.transactions);

    // Balances, summary, and verify must ignore the uncommitted lot.
    assert.equal(f.cash.getBalance(f.cad, f.ledger.transactions), 1000, "uncommitted receipt must not change the balance");
    assert.equal(f.ledger.summarize(f.cad).netAssets.balance, 1000, "uncommitted receipt must not change the summary");
    assert.ok(f.ledger.verify().ok, "ledger must still verify with an uncommitted lot outstanding");

    // Committing it inside a balanced transaction makes it count.
    const event = f.ledger.beginEvent();
    const equityInputs = generateInputs(f.openingBalance, f.cad, 750, event.view());
    event.record(new Transaction(equityInputs, receipt, event.view()));
    event.register();

    assert.equal(f.cash.getBalance(f.cad, f.ledger.transactions), 1750, "committed receipt now counts");
    assert.ok(f.ledger.verify().ok, "ledger still balances after committing the receipt");
});

test("removing a committed transaction from the transactions array un-commits its lots everywhere, with nothing left over to disagree", () => {
    const f = makeFixture();
    openInto(f, f.cash, f.cad, 1000);

    // Commit a second transaction that both consumes the opening lot and mints a new one.
    const event = f.ledger.beginEvent();
    const withdrawal = event.stageTransaction({
        inputs: { account: f.cash, position: f.cad, quantity: 400 },
        outputs: { account: f.drawings, position: f.cad, quantity: 400 }
    });
    event.register();

    assert.equal(f.cash.getBalance(f.cad, f.ledger.transactions), 600, "the withdrawal is committed");
    assert.equal(f.drawings.getBalance(f.cad, f.ledger.transactions), 400);
    assert.ok(f.ledger.verify().ok);

    // Splice the withdrawal transaction back out of the ledger's own history array — simulating an
    // undo — without going through any dedicated API.
    const index = f.ledger.transactions.indexOf(withdrawal);
    f.ledger.transactions.splice(index, 1);

    // Every account's balance recomputes as if the withdrawal never happened: there is no separate
    // lot store left holding onto the consumed opening lot or the minted drawings lot.
    assert.equal(f.cash.getBalance(f.cad, f.ledger.transactions), 1000, "cash balance reverts once the transaction is removed");
    assert.equal(f.drawings.getBalance(f.cad, f.ledger.transactions), 0, "drawings balance reverts once the transaction is removed");
    assert.ok(f.ledger.verify().ok, "ledger still verifies once the transaction is removed");

    // The opening lot the withdrawal had consumed is fully available again — nothing remembers it
    // as already spent, because availability is derived purely from what's in the array now.
    const freshDraw = generateInputs(f.cash, f.cad, 1000, f.ledger.transactions);
    assert.equal(freshDraw.length, 1);
    assert.equal(freshDraw[0]!.quantity, 100000n, "the full original 1000 CAD lot is available, not just the untouched 600 remainder");
});
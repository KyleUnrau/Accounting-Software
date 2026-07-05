import { test } from "node:test";
import assert from "node:assert/strict";

import { makeFixture, openInto, commitSwap } from "../utils/ledger-fixture.js";
import { verifyBalanced } from "../../ledger-kernel/accounts/delta.js";
import type { FolderSummary } from "../../ledger-kernel/accounts/summary.js";

test("accountDeltas reports the same net change getBalance shows before/after a plain transaction", () => {
    const f = makeFixture();
    openInto(f, f.cash, f.cad, 1000);

    const cashBefore = f.cash.getBalance(f.cad, f.ledger.transactions);
    const drawingsBefore = f.drawings.getBalance(f.cad, f.ledger.transactions);

    const event = f.ledger.beginEvent();
    event.stageTransaction({
        inputs: { account: f.cash, position: f.cad, quantity: 300 },
        outputs: { account: f.drawings, position: f.cad, quantity: 300 }
    });
    const ledgerEvent = event.register();

    const cashAfter = f.cash.getBalance(f.cad, f.ledger.transactions);
    const drawingsAfter = f.drawings.getBalance(f.cad, f.ledger.transactions);

    const deltas = ledgerEvent.accountDeltas();
    const cashDelta = deltas.find(d => d.account === f.cash);
    const drawingsDelta = deltas.find(d => d.account === f.drawings);

    assert.ok(cashDelta, "cash must appear in the event's deltas");
    assert.ok(drawingsDelta, "drawings must appear in the event's deltas");
    assert.equal(cashDelta!.delta, cashAfter - cashBefore, "cash delta must match the observed balance change");
    assert.equal(drawingsDelta!.delta, drawingsAfter - drawingsBefore, "drawings delta must match the observed balance change");

    assert.ok(ledgerEvent.verifyBalanced().ok, "a well-formed transaction's deltas must sum to zero per position");
});

test("summarizeDelta's top-level totals match diffing summarize() snapshots taken before and after", () => {
    const f = makeFixture();
    openInto(f, f.cash, f.cad, 1000);

    const before = f.ledger.summarize(f.cad);

    const event = f.ledger.beginEvent();
    event.stageTransaction({
        inputs: { account: f.cash, position: f.cad, quantity: 250 },
        outputs: { account: f.drawings, position: f.cad, quantity: 250 }
    });
    const ledgerEvent = event.register();

    const after = f.ledger.summarize(f.cad);
    const deltaSummary = f.ledger.summarizeDelta(ledgerEvent, f.cad);

    assert.equal(deltaSummary.netAssets.delta, (after.netAssets as FolderSummary).balance - (before.netAssets as FolderSummary).balance);
    assert.equal(deltaSummary.equity.delta, (after.equity as FolderSummary).balance - (before.equity as FolderSummary).balance);
});

test("an exchange event's deltas remain double-entry balanced per position, even across a multi-transaction group", () => {
    const f = makeFixture();
    openInto(f, f.cash, f.cad, 1000);

    commitSwap(f, f.cash, f.cad, 100, f.wallet, f.usd, 90, f.cadToUsd);
    const ledgerEvent = f.ledger.events[f.ledger.events.length - 1]!;

    const result = ledgerEvent.verifyBalanced();
    assert.ok(result.ok, `exchange event deltas must net to zero per position: ${!result.ok ? result.error.message : ""}`);

    const deltas = ledgerEvent.accountDeltas();
    assert.ok(deltas.some(d => d.account === f.cash), "cash (from-side) must appear in the exchange's deltas");
    assert.ok(deltas.some(d => d.account === f.wallet), "wallet (to-side) must appear in the exchange's deltas");
});

test("verifyBalanced flags a deliberately unbalanced set of deltas", () => {
    const f = makeFixture();
    openInto(f, f.cash, f.cad, 1000);

    const event = f.ledger.beginEvent();
    event.stageTransaction({
        inputs: { account: f.cash, position: f.cad, quantity: 300 },
        outputs: { account: f.drawings, position: f.cad, quantity: 300 }
    });
    const ledgerEvent = event.register();

    const tampered = ledgerEvent.accountDeltas().map(d => ({ ...d }));
    tampered[0]!.signedDeltaScaled += 1n;

    const result = verifyBalanced(tampered);
    assert.equal(result.ok, false, "an artificially unbalanced delta set must fail verification");
});

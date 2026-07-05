import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFixture, openInto, commitSwap } from "../utils/ledger-fixture.js";
import { TransactionGroup, OrderedTransactionGroup } from "../../ledger-kernel/transactions/group.js";
import { LedgerEvent } from "../../ledger-kernel/event.js";
import { ExchangeResolution, ExchangeTransactions } from "../../equity-policy/exchange.js";
import { TerminalResolution, TerminalTransactions } from "../../equity-policy/terminal.js";
import { generateInputs, generateOutputs } from "../../ledger-kernel/transactions/staged.js";

// ---------------------------------------------------------------------------
// Transaction.flatten()
// ---------------------------------------------------------------------------

test("Transaction.flatten() returns a single-element array containing itself", () => {
    const f = makeFixture();
    const event = f.ledger.beginEvent();
    const tx = event.stageTransaction({
        inputs: { account: f.openingBalance, position: f.cad, quantity: 100 },
        outputs: { account: f.cash, position: f.cad, quantity: 100 }
    });
    event.register();

    const flat = tx.flatten();
    assert.equal(flat.length, 1);
    assert.equal(flat[0], tx);
});

// ---------------------------------------------------------------------------
// EventBuilder.record(Transaction) / register()
// ---------------------------------------------------------------------------

test("event.record(transaction) commits a transaction and register() appends it as a top-level LedgerEvent", () => {
    const f = makeFixture();

    const event = f.ledger.beginEvent();
    const tx = event.stageTransaction({
        inputs: { account: f.openingBalance, position: f.cad, quantity: 1000 },
        outputs: { account: f.cash, position: f.cad, quantity: 1000 }
    });

    assert.equal(f.ledger.events.length, 0, "nothing is registered until register() is called");

    const registered = event.register();

    assert.ok(registered instanceof LedgerEvent, "ledger history is a sequence of LedgerEvents");
    assert.equal(f.ledger.events.length, 1);
    assert.equal(f.ledger.events[0], registered, "the LedgerEvent is registered as a top-level entry");
    assert.deepEqual([...registered.flatten()], [tx]);
    assert.equal(f.ledger.transactions.length, 1, "the committed transaction is now visible on the ledger");
    assert.equal(f.ledger.transactions[0], tx);
    assert.ok(f.ledger.verify().ok);
});

// ---------------------------------------------------------------------------
// ExchangeTransactions semantic structure
// ---------------------------------------------------------------------------

test("ExchangeTransactions is a TransactionGroup subclass with kind 'exchange'", () => {
    const f = makeFixture();
    openInto(f, f.cash, f.cad, 1000);

    const fromInputs = generateInputs(f.cash, f.cad, 500, f.ledger.transactions);
    const toOutputs = generateOutputs(f.cash, f.usd, 375, f.ledger.transactions);
    const resolution = new ExchangeResolution(
        fromInputs, toOutputs,
        { gain: f.capitalGains, loss: f.capitalLosses }, f.cadToUsd,
        f.ledger.transactions, f.engine
    );
    const exchangeTxs = resolution.constructTransactions();

    assert.ok(exchangeTxs instanceof ExchangeTransactions, "ExchangeTransactions is the concrete type");
    assert.ok(exchangeTxs instanceof TransactionGroup, "ExchangeTransactions extends TransactionGroup");
    assert.equal(exchangeTxs.kind, "exchange");
});

test("ExchangeTransactions.members drops empty intermediates and absent terminalLoss", () => {
    const f = makeFixture();
    openInto(f, f.cash, f.cad, 1000);

    const event = f.ledger.beginEvent();
    const exchangeTxs = event.stageExchange({
        fromInputs: { account: f.cash, position: f.cad, quantity: 500 },
        toOutputs: { account: f.cash, position: f.usd, quantity: 375 },
        residual: { gain: f.capitalGains, loss: f.capitalLosses },
        exchange: f.cadToUsd
    });

    // A pure forward exchange threads no intermediate hops and recognizes no terminal loss.
    assert.equal(exchangeTxs.intermediates.members.length, 0, "no intermediate hops on a pure forward exchange");
    assert.equal(exchangeTxs.terminalLoss, undefined, "no terminal loss on a pure forward exchange");

    // members omits the empty intermediates group and the absent terminalLoss
    assert.deepEqual(exchangeTxs.members, [exchangeTxs.from, exchangeTxs.to], "only from and to are present");
    assert.deepEqual([...exchangeTxs.flatten()], [exchangeTxs.from, exchangeTxs.to], "flatten returns from then to");

    event.register();
    assert.ok(f.ledger.verify().ok);
});

test("ExchangeTransactions.members orders from → to → intermediates when a hop is present", () => {
    const f = makeFixture();
    openInto(f, f.cash, f.cad, 1000);
    // Build a CAD→USD→Oranges loop so closing it back to CAD threads one USD intermediate hop.
    commitSwap(f, f.cash, f.cad, 500, f.cash, f.usd, 375, f.cadToUsd);
    commitSwap(f, f.cash, f.usd, 375, f.inventory, f.oranges, 1500, f.usdToOranges);

    // Close Oranges→CAD at a gain (600 CAD vs 500 basis). The gain keeps terminalLoss undefined,
    // leaving members exactly [from, to, intermediates].
    const event = f.ledger.beginEvent();
    const exchangeTxs = event.stageExchange({
        fromInputs: { account: f.inventory, position: f.oranges, quantity: 1500 },
        toOutputs: { account: f.cash, position: f.cad, quantity: 600 },
        residual: { gain: f.capitalGains, loss: f.capitalLosses },
        exchange: f.orangesToCad
    });

    assert.notEqual(exchangeTxs.intermediates.members.length, 0, "the loop close threads a real intermediate hop");
    assert.equal(exchangeTxs.terminalLoss, undefined, "closing at a gain produces no terminal loss");

    // Commit order: from → to → intermediates. This is an existing ledger-history convention;
    // tests assert it explicitly so it is not changed silently.
    assert.deepEqual(
        exchangeTxs.members,
        [exchangeTxs.from, exchangeTxs.to, exchangeTxs.intermediates],
        "members mirror from → to → intermediates in commit order"
    );

    event.register();
    assert.ok(f.ledger.verify().ok);
});

// ---------------------------------------------------------------------------
// TerminalTransactions semantic structure
// ---------------------------------------------------------------------------

test("TerminalTransactions is a TransactionGroup subclass with kind 'terminal'", () => {
    const f = makeFixture();
    openInto(f, f.cash, f.cad, 1000);

    const inputs = generateInputs(f.cash, f.cad, 50, f.ledger.transactions);
    const resolution = new TerminalResolution(inputs, f.exchangeExpense, f.ledger.transactions, f.engine);
    const terminalTxs = resolution.constructTransactions();

    assert.ok(terminalTxs instanceof TerminalTransactions, "TerminalTransactions is the concrete type");
    assert.ok(terminalTxs instanceof TransactionGroup, "TerminalTransactions extends TransactionGroup");
    assert.equal(terminalTxs.kind, "terminal");
});

// ---------------------------------------------------------------------------
// Every registered ledger entry is a LedgerEvent — even a single semantic bundle
// ---------------------------------------------------------------------------

test("a single-exchange event registers as a LedgerEvent whose sole member is the ExchangeTransactions", () => {
    const f = makeFixture();
    openInto(f, f.cash, f.cad, 1000);

    const event = f.ledger.beginEvent();
    const exchangeTxs = event.stageExchange({
        fromInputs: { account: f.cash, position: f.cad, quantity: 500 },
        toOutputs: { account: f.cash, position: f.usd, quantity: 375 },
        residual: { gain: f.capitalGains, loss: f.capitalLosses },
        exchange: f.cadToUsd
    });

    // Ledger history is a flat, uniform sequence of LedgerEvents — a single-node event is never
    // unwrapped into the bare ExchangeTransactions; the ExchangeTransactions is its sole member.
    const registered = event.register();
    assert.ok(registered instanceof LedgerEvent, "registers as a LedgerEvent, not the raw ExchangeTransactions");
    assert.equal(registered.members.length, 1);
    assert.ok(registered.members[0] instanceof ExchangeTransactions, "the sole member is the ExchangeTransactions");
    assert.equal(f.ledger.events[1], registered, "the LedgerEvent is stored as the top-level entry");
    assert.ok(f.ledger.verify().ok);
});

test("a single-terminal event registers as a LedgerEvent whose sole member is the TerminalTransactions", () => {
    const f = makeFixture();
    openInto(f, f.cash, f.cad, 1000);

    const event = f.ledger.beginEvent();
    const terminalTxs = event.stageTerminal({
        inputs: { account: f.cash, position: f.cad, quantity: 50 },
        account: f.exchangeExpense
    });

    const registered = event.register();
    assert.ok(registered instanceof LedgerEvent, "registers as a LedgerEvent, not the raw TerminalTransactions");
    assert.equal(registered.members.length, 1);
    assert.ok(registered.members[0] instanceof TerminalTransactions, "the sole member is the TerminalTransactions");
    assert.equal(f.ledger.events[1], registered, "the LedgerEvent is stored as the top-level entry");
    assert.ok(f.ledger.verify().ok);
});

test("event.record(resolution) uses the TransactionNodeFactory interface to materialize on the fly", () => {
    const f = makeFixture();
    openInto(f, f.cash, f.cad, 1000);

    const event = f.ledger.beginEvent();
    const view = event.view();
    const fromInputs = generateInputs(f.cash, f.cad, 500, view);
    const toOutputs = generateOutputs(f.cash, f.usd, 375, view);
    const resolution = new ExchangeResolution(
        fromInputs, toOutputs,
        { gain: f.capitalGains, loss: f.capitalLosses }, f.cadToUsd,
        view, f.engine
    );

    // Pass the resolution object itself — EventBuilder calls constructTransactions() internally.
    event.record(resolution);
    const registered = event.register();

    assert.ok(registered instanceof LedgerEvent, "registers as a LedgerEvent");
    assert.ok(registered.members[0] instanceof ExchangeTransactions, "materialized from factory into ExchangeTransactions");
    assert.ok(f.ledger.verify().ok);
});

// ---------------------------------------------------------------------------
// Composite events preserve semantic members
// ---------------------------------------------------------------------------

test("beginEvent() nests sub-flows as semantic nodes rather than anonymous groups", () => {
    const f = makeFixture();
    openInto(f, f.cash, f.cad, 1000);

    const event = f.ledger.beginEvent();

    const expenseTxs = event.stageTerminal({
        inputs: { account: f.cash, position: f.cad, quantity: 50 },
        account: f.exchangeExpense
    });

    const exchangeTxs = event.stageExchange({
        fromInputs: { account: f.cash, position: f.cad, quantity: 500 },
        toOutputs: { account: f.cash, position: f.usd, quantity: 375 },
        residual: { gain: f.capitalGains, loss: f.capitalLosses },
        exchange: f.cadToUsd
    });

    assert.equal(f.ledger.events.length, 1, "only openInto's own event is registered so far");

    const composite = event.register();

    assert.equal(f.ledger.events.length, 2, "the composite is registered as a second top-level event");
    assert.equal(f.ledger.events[1], composite);

    // The composite's members are the semantic bundles themselves — not anonymous .toGroup() results.
    assert.deepEqual(composite.members, [expenseTxs, exchangeTxs], "sub-flows are semantic nodes, not anonymous groups");
    assert.ok(composite.members[0] instanceof TerminalTransactions, "first member is a TerminalTransactions");
    assert.ok(composite.members[1] instanceof ExchangeTransactions, "second member is an ExchangeTransactions");

    assert.equal(
        composite.flatten().length,
        expenseTxs.flatten().length + exchangeTxs.flatten().length,
        "the composite flattens through its nested groups"
    );
    assert.ok(f.ledger.verify().ok, "the ledger verifies once the composite is registered");
});

// ---------------------------------------------------------------------------
// OrderedTransactionGroup recursive flatten
// ---------------------------------------------------------------------------

test("OrderedTransactionGroup.flatten() recurses depth-first through nested groups", () => {
    const f = makeFixture();

    const event = f.ledger.beginEvent();
    const tx = event.stageTransaction({
        inputs: { account: f.openingBalance, position: f.cad, quantity: 100 },
        outputs: { account: f.cash, position: f.cad, quantity: 100 }
    });
    event.register();

    const inner = new OrderedTransactionGroup([tx]);
    const outer = new OrderedTransactionGroup([inner]);

    assert.deepEqual([...outer.flatten()], [tx]);
});

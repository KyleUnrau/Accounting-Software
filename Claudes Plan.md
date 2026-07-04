# Revenue Attribution: Architectural Design

## Context

The accounting engine uses a UTXO/UTXI model with a deterministic provenance graph. Value that leaves the system (expenses, losses) is recorded as non-consumable `TerminalUTXO` lots, fully unwound to origin through the exchange graph via `TerminalResolution`. What the engine currently lacks is any mechanism to record *why* new value enters the system — revenue creates a plain `UTXI` (an `OriginPath` terminal in the basis tree), but there is no graph structure connecting that incoming value back to the terminal event that economically caused it.

The design question is whether to model revenue attribution as an extension of the existing exchange provenance graph, or as a separate, lighter-weight mechanism layered on top of it.

---

## Recommendation: Two Graphs, Strict Policy-Layer Annotation

### Core decision: attribution is not exchange lineage

Exchange lineage and economic attribution are semantically distinct in ways that matter mechanically:

- **Exchange lineage** records value *transformation* (same economic substance in a different form, at a locked rate). It is traversable and recapturable — the locked rate on every `Exchange` edge is used during `recapture()` to recompute exact from-side quantities. The entire `collectChainEdges` / `BasisPath` machinery depends on this: every edge carries a quantity in two positions, and the traversal thread these quantities together.

- **Attribution** records *economic causation* (new value entering because of a prior terminal event). There is no rate, no from-side quantity, no recapture. The terminal event has already been resolved and closed; the revenue is genuinely new value, not a transformation of it.

Attempting to unify them produces one of two bad outcomes:
- A phantom exchange edge between a non-consumable `TerminalUTXO` and a new `UTXI` — incoherent, because terminals cannot be consumed and there is no meaningful exchange rate between cause and effect.
- A new `AttributionPath` arm in the `BasisPath` tree with a new stopping rule in `collectChainEdges` — this adds a third mode to the most complex function in the codebase, requiring interaction tests with loop-mode and full-mode, and risks regressions in exchange/terminal behavior. More fundamentally, `collectChainEdges` runs *backward* (consumed value → origin); attribution runs *forward* (terminal event → resulting revenue). The traversal directions are inverted.

**Conclusion:** Two separate graphs. The exchange graph answers "what prior transactions does this value trace through?" Attribution answers "what revenue did this terminal event cause?" These are inverse questions and belong in separate structures.

---

### GenesisUTXI: reject this abstraction

`GenesisUTXI` is appealing as a structural dual of `TerminalUTXO`, but the symmetry is misleading:

- `TerminalUTXO` overrides `consume()` to throw because that finality is enforced by the accounting engine. The engine *must* know the UTXO is terminal to prevent it from being spent.
- A `GenesisUTXI` would carry an attribution link — but the engine does *not* need this information. `BookValueEngine.traceInput` dispatches on input type and emits an `OriginPath` for plain `UTXI`. A `GenesisUTXI` would either (a) be treated identically to a plain `UTXI` (an `OriginPath`, since there is nothing to recapture), or (b) require a new `AttributionPath` node in the basis tree. Case (a) makes it a pure annotation on a kernel type, which is the wrong layer. Case (b) entangles attribution into the basis engine.

The kernel (`ledger-kernel/`) currently knows nothing about exchange lineage, residual equity, or attribution. That is by design. `Exchange`, `ResidualUTXI`, and `TerminalUTXO` are equity-policy constructs that live in `ledger-kernel/transactions/special-edges/`, and even then, their attribution-relevant behavior (`ExchangeResolution`, `TerminalResolution`) lives in `equity-policy/`. Attribution should follow the same pattern: a new concept in `equity-policy/`, invisible to the kernel.

**Conclusion:** No `GenesisUTXI`. Revenue creates a plain `UTXI`. The attribution fact is recorded as a separate policy-layer record that references that `UTXI` and its causal `TerminalUTXO`.

---

### Attribution as a policy-layer annotation

The right shape is a lightweight record:

```
AttributionLink {
    revenue: UTXI               // the new value entering — must be a plain UTXI
    source: TerminalUTXO        // the terminal event that caused it
    weight: bigint              // proportional weight numerator
    totalWeight: bigint         // denominator (sum of all weights across this revenue UTXI)
}
```

This is **not** a transaction, not a lot, not a graph edge with accounting consequence. It is a pure data record, analogous to how `ResidualUTXI` carries `originBasis: Map<Position, bigint>` as a frozen snapshot — but even lighter, because `originBasis` was computable from the transaction graph at mint time, whereas attribution source is external business knowledge the accountant must supply.

An `AttributionIndex` (a read-only query object, similar to the computed account pattern used by `ExchangeAccount`/`TerminalAccount`) holds a list of `AttributionLink` records and answers:
- "What fraction of revenue UTXI R is attributed to each terminal?"
- "What revenue events were caused by terminal T?"

This lives entirely in `equity-policy/attribution.ts`. Nothing in `ledger-kernel/` changes. `BookValueEngine` does not change. `BasisPath` does not grow a new arm. `collectChainEdges` is not modified. `ledger.verify()` is unchanged.

---

### Attribution edge semantics

**Direction:** Back-reference on `UTXI` → `TerminalUTXO`. The common query is "what caused this revenue?" (backward lookup). Forward lookup ("what revenue did this expense generate?") is answered by scanning the index. Both are supported by the index structure.

**Quantity:** Weights express a fraction of the *revenue* `UTXI`, not of the terminal. The terminal is not "used up" by attribution — it remains final. Multiple revenue events can cite the same terminal; a single revenue event can be split across multiple terminals. Attribution allocates the revenue, not the expense.

**Partial attribution:** First-class. Unattributed revenue (a plain `UTXI` with no `AttributionLink`) is valid and must not be treated as an error by the engine.

**Reuse of existing machinery:**
- Proportional splitting (`splitInputs`, proration utilities in `recaptures.ts`) is directly reusable if computing "what portion of this revenue UTXI's value flows from each terminal source."
- The `collectOriginLeaves` function could be applied to terminal resolution outputs to aggregate per-position origin composition, which might be useful for attribution reporting.
- The bipartite structure of the `AttributionIndex` mirrors the computed-account pattern (`TerminalAccount`, `ResidualAccount`), making the implementation familiar.

---

## Invariants

**I1: Strict temporal ordering.** For any `AttributionLink { revenue, source }`, `source` must be committed to the ledger before `revenue` is committed. Attribution links must be validated at construction time against the transaction history.

**I2: Weight bounds.** For a given revenue `UTXI`, the sum of `weight / totalWeight` across all `AttributionLink`s referencing it must not exceed 1. Over-attribution (claiming more than 100% of a revenue event) is an error; under-attribution is valid (partial attribution).

**I3: Attribution is balance-neutral.** Adding or removing `AttributionLink`s has no effect on `ledger.verify()`. This is structural if links live outside the transaction graph, but it should be stated explicitly as a design invariant.

**I4: Terminal sources are non-consumable.** Attribution must never call `source.consume()` or add a `UTXOConsumption` referencing a `TerminalUTXO`. This is already structurally enforced by `TerminalUTXO.consume()` throwing, but the invariant should be documented at the attribution layer: the referenced terminal is cited, not consumed.

**I5: Attribution sources must be committed terminals.** `AttributionLink.source` must be a `TerminalUTXO` that has been committed to the ledger. Links to uncommitted or hypothetical terminals are invalid.

**I6: Revenue inputs must be plain UTXIs.** Attribution applies only to "origin" inflows — new value entering the system (`UTXI`). Attributing an `ExchangedUTXI` is incoherent (that value is not new, it is a transformation). Attributing a `ResidualUTXI` is similarly incoherent (that is deferred equity, not external inflow). The type system enforces this if `AttributionLink.revenue` is typed as `UTXI` (not `Input`).

**I7: No attribution chains.** Attribution sources must be `TerminalUTXO` records — not other `UTXI`s, not prior revenue events. This keeps the attribution graph bipartite (revenues on one side, terminals on the other) and avoids cycles, multi-hop chains, and the question of what the "ultimate" cause of attributed revenue is. Multi-hop business causal chains should be modeled at the domain layer above the engine, not as graph edges within it.

---

## What `OriginPath` could optionally carry

Currently `OriginPath { type: "origin", quantity, position }` discards the `UTXI` reference. The basis tree does not retain a pointer back to the actual input object — it only records the position and quantity. This means a reporting tool walking a `BasisPath[]` tree cannot directly look up attribution for the origin `UTXI` without a separate join.

This is a minor, contained enhancement worth noting: `OriginPath` could carry `readonly utxi: UTXI` alongside `quantity` and `position`. This does not change any semantics — it just retains the pointer that `traceInput` already has at dispatch time. It would allow combined queries ("what was the exchange lineage of this revenue, and what terminal caused it?") to be satisfied by a single basis tree walk followed by an attribution index lookup, without requiring a second scan of the transaction history.

This is not required by the attribution model but would make attribution reporting more natural to implement.

---

## What NOT to do

| Approach | Why not |
|---|---|
| `GenesisUTXI` kernel subclass | Injects attribution into the kernel, which does not need it. Either ignored by the engine (annotation on the wrong layer) or requires `AttributionPath` in the basis tree (entangles causation with transformation). |
| `AttributionPath` in `BasisPath` tree | `collectChainEdges` runs backward (consumed → origin); attribution runs forward (terminal → revenue). Adding a third mode creates interaction complexity with loop-mode and full-mode, and risks regressions in exchange/terminal behavior. |
| Attribution as `TransactionGroup` | `TransactionGroup` semantics imply balanced accounting consequence. Attribution has none. Misleading and creates false coupling to commit ordering. |
| Event correlation by external keys | Flexible but structurally weak. No enforcement of temporal ordering, proportional weights, or terminal-only sources. Inconsistent with the engine's philosophy of explicit structural edges with computable invariants. |
| Accrual matching (deferred liability) | Requires prospective knowledge of revenue at expense time. The engine's design is retrospective (cost basis tracing). Accrual matching is a valid accounting method but is a different model that would require knowing expected revenue size at expense time — inappropriate for uncertain or unknown revenue consequences. |
| Mandatory complete attribution | Requires the engine to have business domain knowledge (which expenses must produce which revenues). That is a domain concern, not an accounting structure concern. |

---

## Layer assignments

| Concept | Layer | Notes |
|---|---|---|
| `UTXI` (revenue inflow) | `ledger-kernel/` — unchanged | Plain `UTXI` as always |
| `TerminalUTXO` (attributed source) | `ledger-kernel/` — unchanged | Structural finality preserved |
| `AttributionLink` | `equity-policy/attribution.ts` — new | Pure record, no accounting consequence |
| `AttributionIndex` | `equity-policy/attribution.ts` — new | Read-only query object, analogous to computed accounts |
| `BookValueEngine` | `equity-policy/book-value/engine.ts` — unchanged | BasisPath tree not modified |
| `collectChainEdges` / `collectCarryBacks` | `equity-policy/book-value/lineage.ts` — unchanged | No new traversal mode |
| `ExchangeResolution` / `TerminalResolution` | `equity-policy/` — unchanged | Resolution pipelines unmodified |
| `ledger.verify()` | `ledger-kernel/ledger.ts` — unchanged | Attribution is balance-neutral |

---

## Verification approach (when implementation begins)

1. Confirm `ledger.verify()` passes identically before and after adding attribution links to an existing scenario.
2. Confirm `BookValueEngine.compute()` output is identical before and after attribution links exist.
3. Write a scenario where expense E → revenue R, assert attribution index correctly maps E → R and R → E.
4. Assert that partial attribution (only 60% of R attributed) leaves the remainder as a valid unattributed state.
5. Assert that constructing an `AttributionLink` with an uncommitted terminal throws at construction time.
6. Assert that constructing an `AttributionLink` where `revenue` is an `ExchangedUTXI` or `ResidualUTXI` is rejected at the type level.
7. Assert that weight overflow (sum > totalWeight) is caught at construction time.

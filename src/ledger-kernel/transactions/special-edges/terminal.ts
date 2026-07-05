import type { TerminalAccount } from "../../accounts/computed.js";
import type { Position } from "../../positions.js";
import { UTXO } from "../outputs.js";


/**
 * A **terminal settlement record** — the final recognition of origin-basis value leaving the system:
 * an expense, a realized exchange loss, or a negative-residual settlement. It is *output-shaped* so
 * it can balance the transaction it settles and be summed for reporting, but it is **not** ordinary
 * inventory: no {@link Account} ever selects it via a disposal method, and it never appears as a
 * transaction source.
 *
 * Terminality is encoded structurally:
 * - it lives only in a {@link TerminalAccount}, which exposes no `generateInputs` (cannot be a source);
 * - {@link consume} is overridden to throw, so even a stray attempt to spend one fails loudly.
 *
 * The owning {@link account} is referenced back so {@link TerminalAccount} can attribute balances by
 * scanning the transaction history for lots pointing to itself.
 */

export class TerminalUTXO extends UTXO<TerminalAccount> {
    public type = "terminal-utxo";

    constructor(
        quantity: bigint,
        position: Position,
        account: TerminalAccount
    ) { super(quantity, position, account); }

    /** Terminal records are final; they can never be consumed, exchanged, or transferred. */
    public override consume(): never {
        throw new Error("TerminalUTXO is a terminal settlement record and cannot be consumed");
    }
}

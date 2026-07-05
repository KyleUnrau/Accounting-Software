import type { Result } from "../../utils.js";
import { type Position, unscale } from "../positions.js";
import type { Transaction, TransactionView } from "../transactions/transaction.js";
import { UTXI } from "../transactions/inputs.js";
import { UTXO } from "../transactions/outputs.js";
import { AccountFolder } from "./folder.js";
import { getDisplayName, type AccountNode } from "./node.js";
import type { AccountDeltaSummary, FolderDeltaSummary, NodeDeltaSummary } from "./summary.js";
import type { Account } from "./account.js";

/**
 * The net effect a batch of transactions had on one account/position pair, in the same ledger-wide
 * UTXO-positive/UTXI-negative convention as {@link AccountNode.getSignedBalanceScaled} — before that
 * account's own orientation is applied. A freshly minted UTXO/UTXI output/input contributes its full
 * face quantity (it cannot already have been consumed within the same batch that mints it); a
 * UTXOConsumption/UTXIConsumption contributes its settled quantity against whichever account minted
 * the lot it draws down — not the account of the transaction that placed the consumption.
 */
export interface AccountDelta {
    account: AccountNode;
    position: Position;
    /** Unoriented, ledger-wide-convention delta, in the position's smallest unit. */
    signedDeltaScaled: bigint;
    /** `signedDeltaScaled` with the account's own effective orientation applied. */
    deltaScaled: bigint;
    /** `deltaScaled` unscaled to a human-readable number. */
    delta: number;
}

export class Deltas {
    public static getUtxis(transactions: readonly TransactionView[], position?: Position, account?: Account): UTXI[] {
        const result: UTXI[] = [];
        for (const tx of transactions) for (const input of tx.inputs)
            if (input instanceof UTXI && (position ? input.position === position : true) && (account ? input.account === account : true)) result.push(input);
        return result;
    }

    public static getUtxos(transactions: readonly TransactionView[], position?: Position, account?: Account): UTXO[] {
        const result: UTXO[] = [];
        for (const tx of transactions) for (const output of tx.outputs)
            if (output instanceof UTXO && (position ? output.position === position : true) && (account ? output.account === account: true)) result.push(output);
        return result;
    }

    public static getSignedDeltaScaled(utxis: UTXI[], utxos: UTXO[], transactions: readonly TransactionView[]): bigint {
        let balance = 0n;
        for (const utxi of utxis) balance -= utxi.calculateAvailable(transactions);
        for (const utxo of utxos) balance += utxo.calculateAvailable(transactions);
        return balance;
    }

    public static getPositions(utxis: UTXI[], utxos: UTXO[]): Set<Position> {
        const positions = new Set<Position>();
        for (const utxi of utxis) positions.add(utxi.position);
        for (const utxo of utxos) positions.add(utxo.position);
        return positions;
    }
}

/**
 * Computes the net balance change every touched account experienced across `transactions`, without
 * consulting the wider ledger history. Unlike diffing `account.getBalance()` before and after — which
 * requires reconstructing a "balance at time T" snapshot from a history prefix — a batch's own inputs
 * and outputs already say exactly what it changed, so this works equally well on a single
 * {@link Transaction}, a {@link TransactionGroup}, or a whole {@link LedgerEvent} in isolation.
 */
export function computeAccountDeltas(transactions: readonly Transaction[]): AccountDelta[] {
    const byAccount = new Map<AccountNode, Map<Position, bigint>>();

    function add(account: AccountNode, position: Position, amount: bigint): void {
        let byPosition = byAccount.get(account);
        if (!byPosition) byAccount.set(account, byPosition = new Map());
        byPosition.set(position, (byPosition.get(position) ?? 0n) + amount);
    }

    for (const tx of transactions) {
        for (const output of tx.outputs) {
            if (output instanceof UTXO) add(output.account, output.position, output.quantity);
            else add(output.source.account, output.source.position, output.quantity);
        }
        for (const input of tx.inputs) {
            if (input instanceof UTXI) add(input.account, input.position, -input.quantity);
            else add(input.source.account, input.source.position, -input.quantity);
        }
    }

    const deltas: AccountDelta[] = [];
    for (const [account, byPosition] of byAccount) {
        for (const [position, signedDeltaScaled] of byPosition) {
            const deltaScaled = BigInt(account.getEffectiveOrientation()) * signedDeltaScaled;
            deltas.push({ account, position, signedDeltaScaled, deltaScaled, delta: unscale(deltaScaled, position) });
        }
    }
    return deltas;
}

/**
 * Backstops that a batch of transactions is internally double-entry balanced: every position's
 * signed deltas, summed across every account the batch touched, must net to zero — the same
 * invariant {@link Transaction.verify} enforces per transaction, and {@link Ledger.verify} enforces
 * over the full history. Checking it here needs only the batch's own deltas, so it can pinpoint
 * exactly which event, group, or transaction introduced an imbalance without scanning the ledger.
 */
export function verifyBalanced(deltas: readonly AccountDelta[]): Result<undefined, Error> {
    const sums = new Map<Position, bigint>();
    for (const { position, signedDeltaScaled } of deltas) sums.set(position, (sums.get(position) ?? 0n) + signedDeltaScaled);

    for (const [position, sum] of sums) {
        if (sum !== 0n) return { ok: false, error: new Error(`Account deltas for ${position.name} sum to ${sum} instead of 0`) };
    }
    return { ok: true, value: undefined };
}

/**
 * Builds a {@link NodeDeltaSummary} tree mirroring `root`'s shape (folders nest their children,
 * accounts are leaves) but reporting the balance *change* `deltas` caused for `position` instead of
 * an absolute balance — a diff view of {@link AccountNode.summarize}. Nodes untouched by `deltas`
 * report a zero delta rather than being omitted, so the tree's shape always matches `root`'s.
 */
export function summarizeAccountDelta(root: AccountNode, position: Position, deltas: readonly AccountDelta[]): NodeDeltaSummary {
    const leafSignedDeltas = new Map<AccountNode, bigint>();
    for (const delta of deltas) {
        if (delta.position !== position) continue;
        leafSignedDeltas.set(delta.account, (leafSignedDeltas.get(delta.account) ?? 0n) + delta.signedDeltaScaled);
    }

    function signedSubtreeDelta(node: AccountNode): bigint {
        if (node instanceof AccountFolder) return node.children.reduce((sum, child) => sum + signedSubtreeDelta(child), 0n);
        return leafSignedDeltas.get(node) ?? 0n;
    }

    function build(node: AccountNode): NodeDeltaSummary {
        const deltaScaled = BigInt(node.getEffectiveOrientation()) * signedSubtreeDelta(node);
        const delta = unscale(deltaScaled, position);
        const summary: AccountDeltaSummary = { name: getDisplayName(node.name, delta), orientation: node.getEffectiveOrientation(), delta };

        if (!(node instanceof AccountFolder)) return summary;

        const folderSummary: FolderDeltaSummary = { ...summary, children: node.children.map(build) };
        return folderSummary;
    }

    return build(root);
}

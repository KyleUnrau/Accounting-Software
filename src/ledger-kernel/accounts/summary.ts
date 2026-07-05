import type { Orientation } from "../ledger.js";
import type { Position } from "../positions.js";

export interface LedgerSummary {
    position: Position;
    netAssets: FolderSummary;
    equity: FolderSummary;
}

export interface LedgerDeltaSummary {
    position: Position;
    netAssets: NodeDeltaSummary;
    equity: NodeDeltaSummary;
}

export type NodeSummary = AccountSummary | FolderSummary;

export interface AccountSummary {
    name: string;
    orientation: {
        local: Orientation;
        effective: Orientation;
    };
    balance: number;
}

export interface FolderSummary {
    name: string;
    orientation: {
        local: Orientation;
        effective: Orientation;
    };
    balance: number;
    children: NodeSummary[];
}

/**
 * The diff-view counterpart to {@link AccountSummary}/{@link FolderSummary}: the balance *change* a
 * batch of transactions caused at one node, rather than an absolute balance. Only the node's
 * {@link Orientation.effective} orientation is reported — the change is already oriented, so `local`
 * carries no extra information a debugging view needs. See {@link summarizeAccountDelta}.
 */
export interface AccountDeltaSummary {
    name: string;
    orientation: Orientation;
    delta: number;
}

export interface FolderDeltaSummary extends AccountDeltaSummary {
    children: NodeDeltaSummary[];
}

export type NodeDeltaSummary = AccountDeltaSummary | FolderDeltaSummary;

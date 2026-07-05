import { AccountFolder } from "./folder.js";
import type { DisposalMethod } from "../disposal-methods/disposals.js";
import type { Orientation } from "../ledger.js";
import { type Position } from "../positions.js";
import type { Transaction } from "../transactions/transaction.js";
import { UTXI } from "../transactions/inputs.js";
import { UTXO } from "../transactions/outputs.js";
import { AccountNode, getDisplayName, type AccountName } from "./node.js";
import type { AccountSummary } from "./summary.js";
import { Deltas } from "./delta.js";

export class Account extends AccountNode {
    constructor(
        name: AccountName,
        localOrientation: Orientation,
        parent: AccountFolder | null,
        public readonly utxoDisposalMethod: DisposalMethod<UTXO>,
        public readonly utxiDisposalMethod: DisposalMethod<UTXI>
    ) {
        super(name, localOrientation, parent);
    }

    public getSignedBalanceScaled(position: Position, transactions: Transaction[]): bigint {
        const utxis = Deltas.getUtxis(transactions, position, this);
        const utxos = Deltas.getUtxos(transactions, position, this);

        return Deltas.getSignedDeltaScaled(utxis, utxos, transactions);
    }

    public getSignedBalancesScaled(transactions: Transaction[]): Map<Position, bigint> {
        const utxis = Deltas.getUtxis(transactions, undefined, this);
        const utxos = Deltas.getUtxos(transactions, undefined, this);

        const result = new Map<Position, bigint>();
        for (const position of Deltas.getPositions(utxis, utxos)) result.set(
            position,
            Deltas.getSignedDeltaScaled(utxis.filter(u => u.position === position), utxos.filter(u => u.position === position), transactions)
        );

        return result;
    }

    public summarize(position: Position, transactions: Transaction[]): AccountSummary {
        const balance: number = this.getBalance(position, transactions);
        return {
            name: getDisplayName(this.name, balance),
            orientation: {local: this.localOrientation, effective: this.getEffectiveOrientation()},
            balance
        };
    }
}

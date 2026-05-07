import type { TXI, TXIConsumption, TXO, TXOConsumption } from "./transactions.js";

export enum Orientation {
    Positive = 1,
    Negative = -1
}

export type AccountNode = Account | AccountFolder;

export class Account {
    constructor(
        public name: string,
        public localOrientation: Orientation,
        public parent: AccountFolder | null = null,
    ) { }

    public getRootOrientation(): Orientation {
        if (this.parent === null) return this.localOrientation;
        return this.parent.getRootOrientation() * this.localOrientation;
    }
}

export class AccountFolder {
    constructor(
        public name: string,
        public localOrientation: Orientation,
        public children: AccountNode[] = [],
        public parent: AccountFolder | null = null,
    ) {
        for (const child of this.children) child.parent = this;
    }

    public addChild(child: AccountNode): void {
        this.children.push(child);
        child.parent = this;
    }

    public addAccount(name: string, localOrientation: Orientation): Account {
        const child = new Account(name, localOrientation);
        this.addChild(child);
        return child;
    }

    public addFolder(name: string, localOrientation: Orientation): AccountFolder {
        const folder = new AccountFolder(name, localOrientation);
        this.addChild(folder);
        return folder;
    }

    public getRootOrientation(): Orientation {
        if (this.parent === null) return this.localOrientation;
        return this.parent.getRootOrientation() * this.localOrientation;
    }
}

type DisposalMethod<T extends TXO | TXI> = (components: T[], delta: number) => Map<T, number>;

export class AccountTX {
    public txos: TXO[] = [];
    public txis: TXI[] = [];

    constructor(
        public txoDisposalMethod: DisposalMethod<TXO>,
        public txiDisposalMethod: DisposalMethod<TXI>
    ) {}

    public newTransaction(delta: number): (TXO | TXIConsumption)[] | (TXI | TXOConsumption)[] {
        if (delta === 0) throw new Error(`Cannot construct a transaction with a delta of 0`);
        if (delta > 0) {
            const txisSum: number = this.txis.reduce((sum, txi) => sum + txi.calculateAvailable(), 0);
            if (txisSum > -delta) {
                const disposals: Map<TXI, number> = this.txiDisposalMethod(this.txis, -delta);
            } else {
                const disposals: Map<TXI, number> = this.txiDisposalMethod(this.txis, txisSum);
            }
        }
    }
}
import type { TXI, TXO } from "../transactions.js";

export type DisposalMethod<T extends TXO | TXI> = (components: T[], delta: number) => Map<T, number>;
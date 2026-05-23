import type { Input, InputMapping } from "./transactions/inputs.js";
import type { Output, OutputMapping } from "./transactions/outputs.js";

export interface BookValuePolicy {
    onTransaction(inputs: InputMapping, outputs: OutputMapping): void;
    onExchange(from: Output, to: Input): void;
}
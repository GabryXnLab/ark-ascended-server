// Factory: sceglie l'implementazione in base a INSTANCE_PROVIDER (stesso schema di oci/index.ts).

import { config } from "../config.js";
import { MockCostProvider } from "./mock.js";
import type { CostProvider } from "./types.js";

let instance: CostProvider | null = null;

/** In locale (docker) non c'è un costo da leggere: null, e l'import OCI non avviene mai. */
export async function getCostProvider(): Promise<CostProvider | null> {
  if (config.instanceProvider === "docker") return null;
  if (instance) return instance;
  if (config.instanceProvider === "mock") {
    instance = new MockCostProvider();
  } else {
    const { OciCostProvider } = await import("./live.js");
    instance = new OciCostProvider();
  }
  return instance;
}

export type { CostProvider, MonthlyCost } from "./types.js";

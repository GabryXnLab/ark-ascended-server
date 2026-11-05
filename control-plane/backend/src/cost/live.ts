// Costo mensile reale via OCI Usage API (Cost Analysis) — somma tutte le voci
// della tenancy (compute + storage): per questo tenancy tutto il resto è
// Always Free, quindi il totale coincide con il costo del sistema arksa.

import * as usageapi from "oci-usageapi";
import { config } from "../config.js";
import { buildAuthProvider } from "../oci/auth.js";
import { log } from "../logger.js";
import type { CostProvider, MonthlyCost } from "./types.js";

export class OciCostProvider implements CostProvider {
  private client!: usageapi.UsageapiClient;
  private readonly tenantId: string;
  private ready: Promise<void>;

  constructor() {
    if (!config.ociTenancyOcid) throw new Error("OCI_TENANCY_OCID non impostato");
    this.tenantId = config.ociTenancyOcid;
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    const provider = await buildAuthProvider();
    this.client = new usageapi.UsageapiClient({ authenticationDetailsProvider: provider });
  }

  async getMonthlyCost(periodStart: Date, periodEnd: Date): Promise<MonthlyCost> {
    await this.ready;
    // L'API OCI Usage rifiuta timestamp con precisione oraria: richiede
    // troncamento a giorno (00:00:00 UTC). Il chiamante passa già il range
    // corretto (mese richiesto, o "adesso" se il mese è quello corrente);
    // qui ci limitiamo a non superare mai "oggi" nel caso arrivi un periodEnd
    // nel futuro (stesso comportamento di prima per il mese in corso).
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const cappedEnd = periodEnd.getTime() > today.getTime() ? today : periodEnd;

    const res = await this.client.requestSummarizedUsages({
      requestSummarizedUsagesDetails: {
        tenantId: this.tenantId,
        timeUsageStarted: periodStart,
        timeUsageEnded: cappedEnd,
        granularity: usageapi.models.RequestSummarizedUsagesDetails.Granularity.Monthly,
        isAggregateByTime: true,
        queryType: usageapi.models.RequestSummarizedUsagesDetails.QueryType.Cost,
      },
    });

    const items = res.usageAggregation.items;
    let amount = 0;
    let currency = "USD";
    for (const item of items) {
      amount += item.computedAmount ?? 0;
      if (item.currency?.trim()) currency = item.currency;
    }
    log.debug(`Costo mensile OCI: ${amount} ${currency} (${items.length} voci)`);

    return {
      amount: Math.round(amount * 100) / 100,
      currency,
      periodStart: periodStart.toISOString(),
      periodEnd: cappedEnd.toISOString(),
    };
  }
}

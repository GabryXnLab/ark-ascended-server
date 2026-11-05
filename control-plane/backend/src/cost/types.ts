// Astrazione del costo mensile OCI: due implementazioni (mock e live).

export interface MonthlyCost {
  amount: number;
  currency: string;
  periodStart: string; // ISO, inizio periodo richiesto
  periodEnd: string; // ISO, fine periodo richiesto (per il mese corrente: "adesso", non ancora concluso)
}

export interface CostProvider {
  /** Costo totale della tenancy nel periodo [periodStart, periodEnd] richiesto. */
  getMonthlyCost(periodStart: Date, periodEnd: Date): Promise<MonthlyCost>;
}

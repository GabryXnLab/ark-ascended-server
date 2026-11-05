import { config } from "../config.js";
import type { CostProvider, MonthlyCost } from "./types.js";

export class MockCostProvider implements CostProvider {
  async getMonthlyCost(periodStart: Date, periodEnd: Date): Promise<MonthlyCost> {
    // Mock: il valore resta fisso (config.mockMonthlyCostEur) qualunque sia il
    // periodo richiesto — non c'è un vero storico da interrogare — ma il range
    // riportato deve comunque riflettere il periodo richiesto dal chiamante,
    // altrimenti la UI (che mostra periodStart/periodEnd) risulterebbe incoerente
    // quando l'utente cambia mese.
    return {
      amount: config.mockMonthlyCostEur,
      currency: "EUR",
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
    };
  }
}

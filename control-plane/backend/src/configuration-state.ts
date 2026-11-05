import type { AgentArkStatus } from "./agent.js";
import type { GameConfiguration } from "./configs-store.js";

export interface RuntimeConfigurationState {
  activeId: string | null;
  activeRevision: number | null;
  desiredId: string | null;
  desiredRevision: number | null;
  stale: boolean;
}

/** Confronta contenuto salvato, selezione desiderata e revisione davvero online. */
export function buildRuntimeConfigurationState(
  ark: AgentArkStatus | null,
  desiredId: string | null,
  configurations: readonly GameConfiguration[],
): RuntimeConfigurationState {
  const activeId = ark?.profileId ?? null;
  const activeConfig = configurations.find((item) => item.id === activeId);
  const desiredConfig = configurations.find((item) => item.id === desiredId);
  return {
    activeId,
    activeRevision: ark?.configurationRevision ?? null,
    desiredId,
    desiredRevision: desiredConfig?.revision ?? null,
    stale: !!ark?.online && !!activeConfig && ark.configurationRevision !== activeConfig.revision,
  };
}


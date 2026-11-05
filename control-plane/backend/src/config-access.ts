import type { ConfigAccessMode, GameConfiguration } from "./configs-store.js";

export type EffectiveConfigAccess = "none" | ConfigAccessMode;

export interface ConfigAccessActor {
  userId: string;
  /** I profili creati prima dell'ACL memorizzavano l'id della membership come
   * ownerId. Lo accettiamo come alias senza riscritture distruttive del file. */
  legacyOwnerIds?: string[];
  administrator: boolean;
}

export interface ConfigCapabilities {
  access: EffectiveConfigAccess;
  isOwner: boolean;
  canManageAccess: boolean;
  canDelete: boolean;
}

export function configCapabilities(
  configuration: Pick<GameConfiguration, "ownerId" | "accessControl">,
  actor: ConfigAccessActor,
): ConfigCapabilities {
  const isOwner = configuration.ownerId === actor.userId
    || (actor.legacyOwnerIds ?? []).includes(configuration.ownerId);
  if (actor.administrator) {
    return { access: "full", isOwner, canManageAccess: true, canDelete: true };
  }

  const explicit = configuration.accessControl.grants[actor.userId] ?? "none";
  if (configuration.accessControl.administratorLocked) {
    return { access: explicit, isOwner, canManageAccess: false, canDelete: false };
  }
  if (isOwner) {
    return { access: "full", isOwner: true, canManageAccess: true, canDelete: true };
  }
  return { access: explicit, isOwner: false, canManageAccess: false, canDelete: false };
}

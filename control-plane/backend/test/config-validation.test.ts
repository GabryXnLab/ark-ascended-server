import test from "node:test";
import assert from "node:assert/strict";
import { maskSensitiveConfigFields, validateConfigPayloadSettings } from "../src/config-validation.js";
import type { GameConfiguration } from "../src/configs-store.js";
import type { ConfigPayload } from "../src/requests-store.js";

type Overrides = ConfigPayload["iniOverrides"];

function overrides(patch: {
  gus?: Partial<Overrides["gus"]>;
  game?: Partial<Overrides["game"]>;
  launchArgs?: string;
} = {}): Overrides {
  return {
    gus: { values: {}, sections: {}, raw: "", managedKeys: [], ...patch.gus },
    game: { values: {}, sections: {}, raw: "", managedKeys: [], ...patch.game },
    launchArgs: patch.launchArgs ?? "",
  };
}

test("accetta una configurazione con valori, sezioni e raw coerenti", () => {
  assert.equal(validateConfigPayloadSettings(overrides()), null);
  assert.equal(validateConfigPayloadSettings(overrides({
    gus: {
      values: { SessionName: "Il mio server", XPMultiplier: "1.5", MaxPlayers: "30", serverPVE: "False", ServerPassword: "" },
      sections: { SessionName: "SessionSettings", MaxPlayers: "ARKSA.Launch" },
      raw: "[MiaMod]\nDuration=5\nMessage=ciao",
      managedKeys: ["SessionName", "XPMultiplier", "MaxPlayers", "serverPVE", "ServerPassword"],
    },
    game: {
      values: { "PerLevelStatsMultiplier_Player[0]": "1.5" },
      raw: "OverridePlayerLevelEngramPoints=8\nOverridePlayerLevelEngramPoints=10",
    },
    launchArgs: "-culture=it\n-DisableCustomCosmetics",
  })), null);
});

test("rifiuta tipi, intervalli e chiavi sconosciute con messaggi italiani", () => {
  const error = (patch: Parameters<typeof overrides>[0]) => validateConfigPayloadSettings(overrides(patch)) ?? "";
  assert.match(error({ gus: { values: { XPMultiplier: "abc" } } }), /Moltiplicatore XP.*numero/);
  assert.match(error({ gus: { values: { XPMultiplier: "-1" } } }), /inferiore al minimo 0/);
  assert.match(error({ gus: { values: { DifficultyOffset: "2" } } }), /fuori dall'intervallo/);
  assert.match(error({ gus: { values: { XPMultiplier: "9".repeat(400) } } }), /numero finito/);
  assert.match(error({ gus: { values: { MaxPlayers: "2.5" } } }), /intero/);
  assert.match(error({ gus: { values: { serverPVE: "yes" } } }), /True o False/);
  assert.match(error({ gus: { values: { NonEsiste: "1" } } }), /non è un'impostazione del catalogo/);
  assert.match(error({ gus: { values: { xpmultiplier: "1" } } }), /va scritta come 'XPMultiplier'/);
  assert.match(error({ gus: { values: { SessionName: "x" }, sections: { SessionName: "ServerSettings" } } }), /sezione \[SessionSettings\]/);
  assert.match(error({ gus: { values: { SessionName: "a\nb" } } }), /nuove righe/);
  assert.match(error({ gus: { managedKeys: ["Inventata"] } }), /managedKeys.*catalogo/);
});

test("rifiuta raw duplicati per sezione, chiavi di catalogo e chiavi infrastrutturali", () => {
  const error = (patch: Parameters<typeof overrides>[0]) => validateConfigPayloadSettings(overrides(patch)) ?? "";
  assert.match(error({ game: { values: { BabyMatureSpeedMultiplier: "2" }, raw: "BabyMatureSpeedMultiplier=9" } }), /duplica un campo/);
  assert.match(error({ game: { raw: "BabyMatureSpeedMultiplier=9" } }), /campo del catalogo.*parametri di gioco/);
  assert.match(error({ gus: { raw: "ServerAdminPassword=x" } }), /gestita dall'infrastruttura/);
  assert.match(error({ gus: { raw: "; BEGIN ARKSA MANAGED CONFIG" } }), /marker interni/);
  assert.match(error({ gus: { raw: "[]\nFoo=1" } }), /Intestazione di sezione/);
  assert.match(error({ gus: { raw: "testo libero senza uguale" } }), /Chiave=Valore/);
});

test("il duplicato col raw vale solo nella stessa sezione", () => {
  // Duration di un mod in un'altra sezione non è il campo "Durata messaggio del giorno".
  assert.equal(validateConfigPayloadSettings(overrides({
    gus: {
      values: { Duration: "20" },
      sections: { Duration: "MessageOfTheDay" },
      raw: "[ModX]\nDuration=9\nMessage=keep",
    },
  })), null);
});

test("i moltiplicatori oltre lo slider 0–6 e i profili storici restano salvabili", () => {
  // Valori reali delle configurazioni di produzione («Genesis 1», «Astraeos Descended»).
  assert.equal(validateConfigPayloadSettings(overrides({
    gus: {
      values: {
        MaxPlayers: "3", RCONEnabled: "True", TamingSpeedMultiplier: "100", ItemStackSizeMultiplier: "100",
        HarvestAmountMultiplier: "20", OverrideOfficialDifficulty: "7",
      },
      sections: { MaxPlayers: "/Script/Engine.GameSession" },
    },
    game: {
      values: {
        BabyMatureSpeedMultiplier: "50000", MatingSpeedMultiplier: "300", LayEggIntervalMultiplier: "300",
        EggHatchSpeedMultiplier: "85", CustomRecipeEffectivenessMultiplier: "10",
      },
    },
  })), null);
});

test("accetta le chiavi spostate di file nella vecchia posizione (migra l'agent)", () => {
  assert.equal(validateConfigPayloadSettings(overrides({
    gus: { values: { IgnorePVPMountedWeaponryRestrictions: "True" }, managedKeys: ["IgnorePVPMountedWeaponryRestrictions"] },
    game: { values: { ImplantSuicideCD: "600" } },
  })), null);
});

test("valida le stringhe che finiscono nell'URL di avvio e nell'INI", () => {
  const error = (key: string, value: string, section?: string) => validateConfigPayloadSettings(overrides({
    gus: { values: { [key]: value }, sections: section ? { [key]: section } : {} },
  })) ?? "";
  assert.match(error("SessionName", "Mio ? server", "SessionSettings"), /\? e "/);
  assert.match(error("SessionName", 'Il "server"', "SessionSettings"), /\? e "/);
  assert.match(error("SessionName", " spazi ", "SessionSettings"), /spazi iniziali/);
  assert.equal(error("SessionName", "Server con spazi e àccènti", "SessionSettings"), "");
  assert.match(error("ServerPassword", "a b"), /spazi non sono ammessi/);
  assert.match(error("ServerPassword", "a?b"), /\? e "/);
  assert.match(error("SpectatorPassword", 'x"y'), /\? e "/);
  assert.equal(error("ServerPassword", ""), "");
  assert.equal(error("SpectatorPassword", "spettatore1"), "");
  assert.match(error("BanListURL", "ftp://x/y"), /http:\/\/ o https:\/\//);
  assert.equal(error("BanListURL", "https://example.org/ban.txt"), "");
  assert.equal(error("BanListURL", '"https://example.org/ban.txt"'), "");
  assert.match(error("ClusterId", "a b", "ARKSA.Launch"), /spazi/);
  assert.match(error("MultiHome", "non-un-ip", "SessionSettings"), /indirizzo IP/);
});

test("ServerPlatform accetta solo i valori ASA e le loro combinazioni", () => {
  const error = (value: string) => validateConfigPayloadSettings(overrides({
    gus: { values: { ServerPlatform: value }, sections: { ServerPlatform: "ARKSA.Launch" } },
  })) ?? "";
  for (const value of ["ALL", "PC", "PS5", "XSX", "WINGDK", "PC+XSX", "PC+XSX+PS5", "XSX+PS5+WINGDK"]) {
    assert.equal(error(value), "", value);
  }
  for (const value of ["pc", "PC+", "PC XSX", "PCC", "PC+XSX+PS5+WINGDK", "ALL+PC"]) {
    assert.match(error(value), /valore non ammesso/, value);
  }
});

test("la password spettatore è visibile solo a chi ha accesso alla configurazione", () => {
  const configuration: GameConfiguration = {
    id: "c1",
    revision: 1,
    name: "Astraeos",
    map: "Astraeos_WP",
    mods: [],
    iniOverrides: {
      gus: {
        values: { ServerPassword: "entra", SpectatorPassword: "spia", XPMultiplier: "2" },
        sections: {},
        raw: "[ServerSettings]\nspectatorpassword=spia\nAltro=1",
        managedKeys: ["SpectatorPassword"],
      },
      game: { values: {}, sections: {}, raw: "" },
    },
    ownerId: "owner",
    ownerName: "Owner",
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
  };
  const hidden = maskSensitiveConfigFields(configuration, "none");
  assert.deepEqual(hidden.iniOverrides.gus.values, { ServerPassword: "entra", XPMultiplier: "2" });
  assert.equal(hidden.iniOverrides.gus.raw, "[ServerSettings]\nAltro=1");
  assert.equal(configuration.iniOverrides.gus.values.SpectatorPassword, "spia", "l'originale non cambia");
  for (const access of ["review", "full"] as const) {
    assert.equal(maskSensitiveConfigFields(configuration, access).iniOverrides.gus.values.SpectatorPassword, "spia");
  }
});

test("rifiuta argomenti di avvio non validi o riservati", () => {
  const error = (launchArgs: string) => validateConfigPayloadSettings(overrides({ launchArgs })) ?? "";
  assert.match(error("culture=it"), /Argomenti di avvio.*deve iniziare/);
  assert.match(error("-WinLiveMaxPlayers=99"), /gestito da un campo dedicato/);
});

test("riassume al massimo cinque errori", () => {
  const values = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`Sconosciuta${index}`, "1"]));
  const message = validateConfigPayloadSettings(overrides({ gus: { values } })) ?? "";
  assert.match(message, /altri 3 errori/);
});

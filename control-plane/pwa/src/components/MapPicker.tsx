import { useState } from "react";
import type { CSSProperties } from "react";
import { Check, PencilLine, Copy } from "lucide-react";
import { OFFICIAL_MAPS, type MapPreset } from "../mapCatalog";
import type { GameConfiguration } from "../types";

function MapCard({ preset, selected, onSelect }: {
  preset: MapPreset; selected: boolean; onSelect: (p: MapPreset) => void;
}) {
  const Icon = preset.icon;
  const [imgFailed, setImgFailed] = useState(false);
  const previewUrl = preset.previewImageUrl;
  const showImage = !!previewUrl && !imgFailed;

  return (
    <button
      type="button"
      className={`map-preset-card ${selected ? "map-preset-card-active" : ""} ${showImage ? "map-preset-card-photo" : ""}`}
      onClick={() => onSelect(preset)}
      title={preset.description}
      style={{ "--map-accent": preset.accent } as CSSProperties}
    >
      {showImage ? (
        <>
          <img
            src={previewUrl ?? undefined}
            alt=""
            className="map-preset-photo"
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
          <span className="map-preset-photo-scrim" />
          <span className="map-preset-name map-preset-name-photo">{preset.name}</span>
        </>
      ) : (
        <>
          <span className="map-preset-icon" style={{ background: preset.accent }}>
            <Icon size={20} />
          </span>
          <span className="map-preset-name">{preset.name}</span>
        </>
      )}
      {selected && <Check size={14} className="map-preset-check" />}
    </button>
  );
}

/** Selettore mappe ufficiali preimpostate, più opzione mappa personalizzata (es. mod-mappa). */
export function MapPicker({ map, onSelectPreset, onCustomMap, otherConfigs, copyMapFrom, onCopyMap }: {
  map: string;
  onSelectPreset: (preset: MapPreset) => void;
  onCustomMap: (map: string) => void;
  otherConfigs: GameConfiguration[];
  copyMapFrom: string;
  onCopyMap: (id: string) => void;
}) {
  const activePreset = OFFICIAL_MAPS.find((p) => p.map === map);
  const isCustom = map.trim() !== "" && !activePreset;

  return (
    <section className="card">
      <div className="section-header">
        <h2>Mappa</h2>
        {otherConfigs.length > 0 && (
          <label className="copy-from-inline" title="Copia la mappa da un'altra configurazione">
            <Copy size={13} />
            <select value={copyMapFrom} onChange={(e) => onCopyMap(e.target.value)}>
              <option value="">Copia da…</option>
              {otherConfigs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
      </div>

      <p className="muted small mt-8" style={{ marginBottom: "8px" }}>Mappe ufficiali</p>
      <div className="map-preset-grid">
        {OFFICIAL_MAPS.map((p) => (
          <MapCard key={p.id} preset={p} selected={p.map === map} onSelect={onSelectPreset} />
        ))}
      </div>

      <div className="field-box mt-16">
        <label>
          <span className="field-hint">
            <PencilLine size={12} style={{ verticalAlign: "-1px" }} /> Mappa personalizzata (WP)
          </span>
          <input
            value={isCustom ? map : ""}
            onChange={(e) => onCustomMap(e.target.value)}
            placeholder="es. una mod-mappa non elencata sopra"
          />
        </label>
      </div>
    </section>
  );
}

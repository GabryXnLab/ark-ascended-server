import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Sliders, ChevronDown, ChevronRight, Search, Copy, X } from "lucide-react";
import { GAME_SETTINGS, type GameSettingCategory, type GameSettingField } from "../gameSettingsSchema";
import {
  GAME_SETTING_TAG_LABELS,
  GAME_SETTING_TAGS,
  gameSettingMatchesQuery,
  type GameSettingTagId,
} from "../gameSettingsTaxonomy";
import { DragNumberField } from "./DragNumberField";
import { sliderRange } from "../numberSnap";
import { isModifiedSetting } from "../gameSettingValues";
import { valueError } from "../configRules";
import type { GameConfiguration } from "../types";

function controlId(categoryId: string, key: string): string {
  return `game-setting-${categoryId}-${key}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

/**
 * Editor navigabile delle variabili scalari ASA di GameUserSettings.ini + Game.ini.
 * Componente controllato: chi lo usa conserva lo stato (`values`).
 */
export function GameSettingsEditor({
  values, onChange, description, otherConfigs, getConfigIniValues, advancedCount = 0,
}: {
  values: Record<string, string>;
  onChange: Dispatch<SetStateAction<Record<string, string>>>;
  description?: string;
  /** Direttive INI avanzate e argomenti di avvio non vuoti, contati nel riepilogo. */
  advancedCount?: number;
  otherConfigs?: GameConfiguration[];
  getConfigIniValues?: (cfg: GameConfiguration) => Record<string, string>;
}) {
  const [filter, setFilter] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedTag, setSelectedTag] = useState<"all" | GameSettingTagId>("all");
  const [onlyModified, setOnlyModified] = useState(false);
  const [openCats, setOpenCats] = useState<Set<string>>(() => new Set([GAME_SETTINGS[0]?.id ?? ""]));
  const [copyFromByCat, setCopyFromByCat] = useState<Record<string, string>>({});
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  function toggleCat(id: string) {
    setOpenCats((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectCategory(id: string) {
    setSelectedCategory(id);
    if (id !== "all") setOpenCats((current) => new Set(current).add(id));
  }

  function applyCopyCategory(cat: GameSettingCategory, sourceId: string) {
    setCopyFromByCat((current) => ({ ...current, [cat.id]: sourceId }));
    if (!sourceId || !otherConfigs || !getConfigIniValues) return;
    const src = otherConfigs.find((config) => config.id === sourceId);
    if (!src) return;
    const srcValues = getConfigIniValues(src);
    // Sostituisce sempre la categoria completa, anche quando la vista è filtrata.
    // I valori della sorgente vengono ricontrollati come al salvataggio: uno non
    // valido (vecchio profilo, fuori intervallo) non viene copiato.
    const copied: Record<string, string> = {};
    let skipped = 0;
    for (const field of cat.fields) {
      const value = (srcValues[field.key] ?? "").trim();
      if (field.infrastructureManaged || (value === "" && field.key !== "ServerPassword")) {
        copied[field.key] = "";
      } else if (value !== "" && valueError(field, value)) {
        copied[field.key] = "";
        skipped += 1;
      } else {
        copied[field.key] = value;
      }
    }
    setCopyNotice(skipped > 0
      ? `${skipped} ${skipped === 1 ? "valore non valido non è stato copiato" : "valori non validi non sono stati copiati"} da “${src.name}” (${cat.label}).`
      : null);
    onChange((current) => ({ ...current, ...copied }));
  }

  function clearFilters() {
    setFilter("");
    setSelectedCategory("all");
    setSelectedTag("all");
    setOnlyModified(false);
  }

  const filterLower = filter.trim().toLocaleLowerCase("it");
  const isModified = (field: GameSettingField) => isModifiedSetting(field, values[field.key]);
  // Le opzioni superflue su questo hosting compaiono solo nei profili che le hanno già valorizzate.
  const isListed = (field: GameSettingField) => !field.legacy || (values[field.key] ?? "") !== "";
  const totalModified = useMemo(
    () => GAME_SETTINGS.reduce((sum, category) => sum + category.fields.filter((field) => isModifiedSetting(field, values[field.key])).length, 0),
    [values],
  );

  const categoryCounts = useMemo(() => Object.fromEntries(GAME_SETTINGS.map((category) => [
    category.id,
    category.fields.filter((field) => isListed(field) && gameSettingMatchesQuery(field, filterLower, category.label)
      && (selectedTag === "all" || field.tags.includes(selectedTag))
      && (!onlyModified || isModifiedSetting(field, values[field.key]))).length,
  ])), [filterLower, onlyModified, selectedTag, values]);

  const tagCounts = useMemo(() => {
    const counts = new Map<GameSettingTagId, number>();
    for (const category of GAME_SETTINGS) {
      if (selectedCategory !== "all" && category.id !== selectedCategory) continue;
      for (const field of category.fields) {
        if (!isListed(field) || !gameSettingMatchesQuery(field, filterLower, category.label)) continue;
        if (onlyModified && !isModifiedSetting(field, values[field.key])) continue;
        for (const tag of field.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return counts;
  }, [filterLower, onlyModified, selectedCategory, values]);

  const availableTags = useMemo(() => GAME_SETTING_TAGS
    .filter((tag) => (tagCounts.get(tag.id) ?? 0) > 0 || tag.id === selectedTag)
    .sort((a, b) => a.label.localeCompare(b.label, "it")), [selectedTag, tagCounts]);

  const visibleCategories = useMemo(() => GAME_SETTINGS
    .filter((category) => selectedCategory === "all" || category.id === selectedCategory)
    .map((category) => ({
      category,
      fields: category.fields.filter((field) => isListed(field) && gameSettingMatchesQuery(field, filterLower, category.label)
        && (selectedTag === "all" || field.tags.includes(selectedTag))
        && (!onlyModified || isModifiedSetting(field, values[field.key]))),
    }))
    .filter(({ fields }) => fields.length > 0), [filterLower, onlyModified, selectedCategory, selectedTag, values]);

  const resultCount = visibleCategories.reduce((total, category) => total + category.fields.length, 0);
  const filtersActive = filterLower !== "" || selectedCategory !== "all" || selectedTag !== "all" || onlyModified;
  const forceOpen = filtersActive;

  return (
    <section className="card game-settings-editor" aria-labelledby="game-settings-title">
      <div className="game-settings-heading">
        <div>
          <h2 id="game-settings-title"><Sliders size={16} /> Parametri di gioco</h2>
          <p className="muted small game-settings-intro">
            {description ??
              "422 parametri scalari ASA verificati. Un campo vuoto usa il default del gioco; struct, liste e chiavi ripetute restano nell'editor avanzato."}
          </p>
        </div>
        <span className="game-settings-total" aria-label="422 impostazioni disponibili">422</span>
      </div>

      <div className="game-settings-toolbar" role="search" aria-label="Filtra le impostazioni ARK">
        <label className="search-field game-settings-search">
          <span className="sr-only">Cerca impostazioni</span>
          <Search size={16} />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Cerca nome, chiave, descrizione o tag…"
            autoComplete="off"
          />
        </label>

        <label className="game-settings-tag-filter">
          <span>Tag</span>
          <select value={selectedTag} onChange={(event) => setSelectedTag(event.target.value as "all" | GameSettingTagId)}>
            <option value="all">Tutti i tag</option>
            {availableTags.map((tag) => (
              <option key={tag.id} value={tag.id}>{tag.label} ({tagCounts.get(tag.id) ?? 0})</option>
            ))}
          </select>
        </label>

        <label className="game-settings-modified-filter">
          <input type="checkbox" checked={onlyModified} onChange={(event) => setOnlyModified(event.target.checked)} />
          <span>Solo modificate</span>
        </label>
      </div>

      <nav className="game-settings-category-nav" aria-label="Categorie impostazioni ARK">
        <button
          type="button"
          className={`game-settings-category-chip ${selectedCategory === "all" ? "is-active" : ""}`}
          aria-pressed={selectedCategory === "all"}
          onClick={() => selectCategory("all")}
        >
          Tutte <span>{Object.values(categoryCounts).reduce((sum, count) => sum + count, 0)}</span>
        </button>
        {GAME_SETTINGS.map((category) => (
          <button
            type="button"
            className={`game-settings-category-chip ${selectedCategory === category.id ? "is-active" : ""}`}
            aria-pressed={selectedCategory === category.id}
            onClick={() => selectCategory(category.id)}
            key={category.id}
          >
            {category.label} <span>{categoryCounts[category.id] ?? 0}</span>
          </button>
        ))}
      </nav>

      <div className="game-settings-results" aria-live="polite">
        <span>
          {resultCount} {resultCount === 1 ? "impostazione" : "impostazioni"} in {visibleCategories.length} {visibleCategories.length === 1 ? "categoria" : "categorie"}
          {" · "}{totalModified} {totalModified === 1 ? "modificata" : "modificate"}
          {advancedCount > 0 && ` + ${advancedCount} ${advancedCount === 1 ? "direttiva avanzata" : "direttive avanzate"}`}
        </span>
        {filtersActive && (
          <button type="button" className="game-settings-clear" onClick={clearFilters}><X size={13} /> Azzera filtri</button>
        )}
      </div>

      {copyNotice && <p className="muted small" role="status">{copyNotice}</p>}

      <div className="accordion game-settings-accordion">
        {visibleCategories.map(({ category: cat, fields }) => {
          const isOpen = forceOpen || openCats.has(cat.id);
          const modifiedCount = cat.fields.filter(isModified).length;
          const panelId = `game-settings-panel-${cat.id}`;
          const headerId = `game-settings-header-${cat.id}`;
          return (
            <div className={`accordion-item game-settings-category ${isOpen ? "is-open" : ""}`} key={cat.id}>
              <div className="accordion-header-row">
                <button
                  type="button"
                  id={headerId}
                  className="accordion-header"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => toggleCat(cat.id)}
                >
                  <span className="game-settings-category-heading">
                    <span className="accordion-title">
                      {cat.label} <span className="count">{fields.length}/{cat.fields.filter(isListed).length}</span>
                    </span>
                    <span className="game-settings-category-description">{cat.description}</span>
                  </span>
                  <span className="game-settings-category-meta">
                    {modifiedCount > 0 && <span className="game-settings-edited-count">{modifiedCount} modificate</span>}
                    {isOpen ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
                  </span>
                </button>
                {otherConfigs && otherConfigs.length > 0 && (
                  <label
                    className="copy-from-inline copy-from-inline-cat"
                    title={`Copia tutti i valori di “${cat.label}” da un'altra configurazione`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Copy size={12} aria-hidden="true" />
                    <span className="sr-only">Copia la categoria {cat.label} da</span>
                    <select
                      aria-label={`Copia la categoria ${cat.label} da un'altra configurazione`}
                      value={copyFromByCat[cat.id] ?? ""}
                      onChange={(event) => applyCopyCategory(cat, event.target.value)}
                    >
                      <option value="">Copia da…</option>
                      {otherConfigs.map((config) => <option key={config.id} value={config.id}>{config.name}</option>)}
                    </select>
                  </label>
                )}
              </div>

              {isOpen && (
                <div className="accordion-body" id={panelId} role="region" aria-labelledby={headerId}>
                  {fields.map((field) => {
                    const id = controlId(cat.id, field.key);
                    const modified = !field.infrastructureManaged && isModified(field);
                    return (
                      <div className={`game-setting-field ${modified ? "is-modified" : ""}`} key={field.key}>
                        <div className="game-setting-field-heading">
                          <label className="field-hint" htmlFor={id}>{field.label}</label>
                          {modified && <span className="game-setting-modified-badge">Modificata</span>}
                        </div>
                        <code className="game-setting-key">{field.key}</code>
                        {field.help && <p className="field-desc" id={`${id}-help`}>{field.help}</p>}

                        <div className="game-setting-control">
                          {field.infrastructureManaged ? (
                            <input
                              id={id}
                              aria-describedby={field.help ? `${id}-help` : undefined}
                              type="text"
                              value="Gestita dall'infrastruttura"
                              disabled
                              readOnly
                            />
                          ) : field.type === "bool" ? (
                            <select
                              id={id}
                              aria-describedby={field.help ? `${id}-help` : undefined}
                              value={values[field.key] ?? ""}
                              onChange={(event) => onChange((current) => ({ ...current, [field.key]: event.target.value }))}
                            >
                              <option value="">(default: {field.defaultValue === "True" ? "Attivo" : field.defaultValue === "False" ? "Disattivo" : "non impostato"})</option>
                              <option value="True">Attivo</option>
                              <option value="False">Disattivo</option>
                            </select>
                          ) : field.choices ? (
                            <select
                              id={id}
                              aria-describedby={field.help ? `${id}-help` : undefined}
                              value={values[field.key] ?? ""}
                              onChange={(event) => onChange((current) => ({ ...current, [field.key]: event.target.value }))}
                            >
                              <option value="">(default: {field.choices.find((choice) => choice.value === field.defaultValue)?.label ?? field.placeholder})</option>
                              {field.choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
                              {(values[field.key] ?? "") !== "" && !field.choices.some((choice) => choice.value === values[field.key]) && (
                                <option value={values[field.key]}>{values[field.key]} (valore non valido)</option>
                              )}
                            </select>
                          ) : field.type === "int" || field.type === "float" ? (
                            <DragNumberField
                              id={id}
                              ariaDescribedBy={field.help ? `${id}-help` : undefined}
                              label={field.label}
                              value={values[field.key] ?? ""}
                              placeholder={field.placeholder}
                              defaultValue={field.defaultValue}
                              {...sliderRange(field)}
                              openEnded={field.sliderMax !== undefined}
                              onChange={(nextValue) => onChange((current) => ({ ...current, [field.key]: nextValue }))}
                            />
                          ) : (
                            <input
                              id={id}
                              aria-describedby={field.help ? `${id}-help` : undefined}
                              type={field.type === "password" ? "password" : "text"}
                              autoComplete={field.type === "password" ? "new-password" : "off"}
                              value={values[field.key] ?? ""}
                              placeholder={field.placeholder}
                              onChange={(event) => onChange((current) => ({ ...current, [field.key]: event.target.value }))}
                            />
                          )}
                        </div>

                        <div className="game-setting-tags" aria-label={`Tag di ${field.label}`}>
                          {field.tags.map((tag) => (
                            <button
                              type="button"
                              className={`game-setting-tag ${selectedTag === tag ? "is-active" : ""}`}
                              aria-pressed={selectedTag === tag}
                              onClick={() => {
                                setSelectedCategory("all");
                                setSelectedTag((current) => current === tag ? "all" : tag);
                              }}
                              key={tag}
                            >
                              {GAME_SETTING_TAG_LABELS[tag]}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {visibleCategories.length === 0 && (
          <div className="game-settings-empty" role="status">
            <Search size={20} />
            <p>Nessuna impostazione corrisponde ai filtri scelti.</p>
            <button type="button" className="btn-secondary" onClick={clearFilters}>Azzera filtri</button>
          </div>
        )}
      </div>
    </section>
  );
}

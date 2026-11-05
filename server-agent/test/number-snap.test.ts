import assert from "node:assert/strict";
import test from "node:test";

interface NumericField {
  key: string;
  type: string;
  defaultValue: string | null;
  min?: number;
  max?: number;
  sliderMax?: number;
  step?: number;
}

type Range = { min: number; max: number; step: number };

interface NumberSnap {
  gridBounds: (range: Range) => { min: number; max: number };
  snapToStep: (value: number, range: Range, keep?: number | null) => number;
  sliderRange: (field: NumericField) => Range;
  snapTypedValue: (value: number, range: Range, keep: number | null, openEnded: boolean) => number;
}

// La PWA non ha un runner: come per il catalogo, il modulo puro viene importato dai test dell'agent.
const { gridBounds, snapToStep, sliderRange, snapTypedValue } = await import(
  new URL("../../control-plane/pwa/src/numberSnap.ts", import.meta.url).href
) as NumberSnap;
const { ALL_GAME_SETTING_FIELDS } = await import(
  new URL("../../control-plane/pwa/src/gameSettingsSchema.ts", import.meta.url).href
) as { ALL_GAME_SETTING_FIELDS: NumericField[] };

const numericFields = ALL_GAME_SETTING_FIELDS.filter((field) => field.type === "int" || field.type === "float");

function onGrid(value: number, step: number): boolean {
  const ratio = value / step;
  return Math.abs(ratio - Math.round(ratio)) < 1e-6;
}

test("il minimo non multiplo del passo non sposta la griglia", () => {
  const cooldown = { min: 1, max: 604800, step: 60 };
  assert.equal(snapToStep(3600, cooldown), 3600);
  assert.equal(snapToStep(7200, cooldown), 7200);
  assert.equal(snapToStep(1, cooldown), 60, "sotto il primo punto di griglia sale al minimo valido");
  assert.deepEqual(gridBounds(cooldown), { min: 60, max: 604800 });

  const crop = { min: 0.01, max: 6, step: 0.05 };
  assert.equal(snapToStep(1, crop), 1);
  assert.equal(snapToStep(2.5, crop), 2.5);
  assert.equal(snapToStep(0.01, crop), 0.05);
});

test("nessun valore cade sotto il minimo o sopra il massimo", () => {
  const range = { min: 0.01, max: 6, step: 0.1 };
  assert.equal(snapToStep(0.01, range), 0.1);
  assert.equal(snapToStep(0.05, range), 0.1);
  assert.equal(snapToStep(-3, range), 0.1);
  assert.equal(snapToStep(99, range), 6);
});

test("un default fuori griglia non viene alterato", () => {
  const range = { min: 0, max: 6, step: 0.1 };
  assert.equal(snapToStep(0.14, range), 0.1);
  assert.equal(snapToStep(0.14, range, 0.14), 0.14);
  assert.equal(snapToStep(9, range, 9), 6, "il default resta comunque dentro il range");
});

test("i default del catalogo sono raggiungibili sulla griglia del proprio campo", () => {
  for (const field of numericFields) {
    if (field.defaultValue === null) continue;
    const defaultNumber = Number(field.defaultValue);
    assert.ok(onGrid(defaultNumber, field.step!), `${field.key}: default ${field.defaultValue} fuori dal passo ${field.step}`);
    const range = sliderRange(field);
    assert.equal(snapToStep(defaultNumber, range), Math.min(range.max, defaultNumber), `${field.key}: il default viene alterato dallo snap`);
  }
});

test("i moltiplicatori float hanno passo fine (0.01, 0.05 o 0.1)", () => {
  const multipliers = numericFields.filter((field) => field.type === "float" && field.key.includes("Multiplier"));
  assert.ok(multipliers.length > 100);
  for (const field of multipliers) {
    assert.ok(field.step! <= 0.1, `${field.key}: passo ${field.step} troppo grossolano per valori frazionari`);
  }
  for (const key of ["TamingSpeedMultiplier", "ItemStackSizeMultiplier", "XPMultiplier", "HarvestAmountMultiplier"]) {
    const field = multipliers.find((candidate) => candidate.key === key)!;
    const range = sliderRange(field);
    assert.equal(snapToStep(0.5, range), 0.5, `${key}: 0.5 non digitabile`);
    assert.equal(snapToStep(1.5, range), 1.5, `${key}: 1.5 non digitabile`);
  }
});

test("in tutto il catalogo il valore snappato sta in griglia e nel range", () => {
  assert.ok(numericFields.length > 250);
  for (const field of numericFields) {
    assert.ok(field.min !== undefined && (field.sliderMax ?? field.max) !== undefined && field.step !== undefined, field.key);
    const range = sliderRange(field);
    const bounds = gridBounds(range);
    assert.ok(bounds.min >= range.min && bounds.max <= range.max, `${field.key}: griglia fuori range`);
    const samples = [
      range.min, range.max, (range.min + range.max) / 2, 0, 1, 2.5, 0.05, 0.01, 7, 100, 3601, -5,
      range.min + range.step * 0.4, range.min + range.step * 1.6,
    ];
    for (const sample of samples) {
      const snapped = snapToStep(sample, range);
      assert.ok(snapped >= range.min && snapped <= range.max, `${field.key}: ${sample} -> ${snapped} fuori range`);
      assert.ok(onGrid(snapped, range.step), `${field.key}: ${sample} -> ${snapped} fuori griglia (passo ${range.step})`);
    }
  }
});

test("un moltiplicatore digitato oltre lo slider resta invariato, solo allineato al passo", () => {
  const taming = numericFields.find((field) => field.key === "TamingSpeedMultiplier")!;
  const range = sliderRange(taming);
  assert.equal(range.max, 6);
  assert.equal(snapTypedValue(85, range, 1, true), 85);
  assert.equal(snapTypedValue(50000, range, 1, true), 50000);
  assert.equal(snapTypedValue(85.03, range, 1, true), 85.05);
  assert.equal(snapTypedValue(2.52, range, 1, true), 2.5, "dentro lo slider vale lo snap normale");
  assert.equal(snapTypedValue(-3, range, 1, true), 0, "il minimo resta un limite");
  assert.equal(snapTypedValue(85, range, 1, false), 6, "un campo limitato viene ancora riportato al massimo");
});

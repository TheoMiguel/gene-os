// biome-ignore-all lint/a11y/noNoninteractiveTabindex: a scrollable region must take focus so keyboard users can scroll it
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';

interface Option<T> {
  readonly value: T;
  readonly label: string;
}

/** A group of radio buttons drawn as the app's segmented buttons. `name` must be unique on the page. */
export function SegmentedField<T extends string | number>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  readonly legend: string;
  readonly name: string;
  readonly value: T;
  readonly options: readonly Option<T>[];
  readonly onChange: (value: T) => void;
}) {
  return (
    <fieldset class="settings-field view-field">
      <legend class="field-label">{legend}</legend>
      <div class="seg-group">
        {options.map((option) => (
          <label key={String(option.value)} class="seg-btn">
            <input
              type="radio"
              class="visually-hidden"
              name={name}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** A labelled drop-down. */
export function SelectField<T extends string | number>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: T;
  readonly options: readonly Option<T>[];
  readonly onChange: (value: T) => void;
}) {
  return (
    <div class="settings-field view-field">
      <label class="field-label" for={id}>
        {label}
      </label>
      <select
        id={id}
        value={String(value)}
        onChange={(event) => {
          const picked = options.find((option) => String(option.value) === event.currentTarget.value);
          if (picked) onChange(picked.value);
        }}
      >
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * A labelled whole-number field. It commits when the user leaves the field or presses Enter, so typing "100"
 * does not run a scan for "1" and "10" on the way.
 */
export function NumberField({
  id,
  label,
  value,
  min,
  max,
  onCommit,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Math.trunc(Number(draft));
    const next =
      Number.isFinite(parsed) && draft.trim() !== '' ? Math.min(Math.max(parsed, min), max) : value;
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <div class="settings-field view-field">
      <label class="field-label" for={id}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={draft}
        onInput={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
      />
    </div>
  );
}

/** A labelled checkbox. */
export function CheckField({
  label,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label class="check view-check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
      {label}
    </label>
  );
}

/** A scrollable block of text that keyboard users can focus and scroll. */
export function ScrollRegion({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ComponentChildren;
}) {
  return (
    <section class="pv-translation" tabIndex={0} aria-label={label}>
      {children}
    </section>
  );
}

import type { ComponentChildren } from 'preact';

interface SegmentedProps<T extends string> {
  /** Accessible name of the group. */
  readonly legend: string;
  /** Radio group name, unique on the page. */
  readonly name: string;
  readonly options: readonly { readonly value: T; readonly label: ComponentChildren }[];
  readonly value: T;
  readonly onChange: (value: T) => void;
}

/** A row of exclusive choices, styled like the settings panel's segmented buttons. */
export function Segmented<T extends string>({ legend, name, options, value, onChange }: SegmentedProps<T>) {
  return (
    <fieldset class="segmented">
      <legend class="visually-hidden">{legend}</legend>
      {options.map((option) => (
        <label key={option.value} class="seg-btn">
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
    </fieldset>
  );
}

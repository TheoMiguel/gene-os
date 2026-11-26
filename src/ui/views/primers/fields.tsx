import { useId, useState } from 'preact/hooks';

interface NumberFieldProps {
  readonly label: string;
  readonly value: number | null;
  readonly onChange: (value: number) => void;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** Unit shown after the label. */
  readonly unit?: string;
}

/**
 * A labelled number input that lets the user type freely ("5." or an empty box) and tells the owner only about
 * complete numbers inside the range. The box shows the owner's value again when it loses focus.
 */
export function NumberField({ label, value, onChange, min, max, step, unit }: NumberFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div class="primers-field">
      <label class="field-label" for={id}>
        {unit ? `${label} (${unit})` : label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        value={draft ?? (value === null ? '' : String(value))}
        {...(min === undefined ? {} : { min })}
        {...(max === undefined ? {} : { max })}
        {...(step === undefined ? {} : { step })}
        onInput={(event) => {
          const text = (event.currentTarget as HTMLInputElement).value;
          setDraft(text);
          const number = Number(text);
          if (
            text.trim() !== '' &&
            Number.isFinite(number) &&
            (min === undefined || number >= min) &&
            (max === undefined || number <= max)
          )
            onChange(number);
        }}
        onBlur={() => setDraft(null)}
      />
    </div>
  );
}

/**
 * Pick a display name and an avatar color (§7). That is the entire identity
 * surface of this product: no account, no email, no PII (§8). The name is
 * session-scoped and thrown away.
 */
import { useId, useRef, useState } from 'react';
import { AVATAR_COLORS } from '@phrasey/shared';

export interface IdentityFormProps {
  name: string;
  color: string;
  submitLabel: string;
  busy?: boolean;
  onChange: (patch: { name?: string; color?: string }) => void;
  onSubmit: () => void;
  autoFocus?: boolean;
}

const MAX_NAME = 16;

export function IdentityForm({
  name,
  color,
  submitLabel,
  busy = false,
  onChange,
  onSubmit,
  autoFocus = false,
}: IdentityFormProps) {
  const nameId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [touched, setTouched] = useState(false);
  const trimmed = name.trim();
  const invalid = touched && trimmed.length === 0;

  return (
    <form
      className="flex w-full max-w-md flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (trimmed.length === 0) {
          inputRef.current?.focus();
          return;
        }
        onSubmit();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={nameId} className="font-mono text-[0.625rem] tracking-[0.16em] uppercase opacity-65">
          Display name
        </label>
        <input
          id={nameId}
          value={name}
          autoFocus={autoFocus}
          maxLength={MAX_NAME}
          autoComplete="off"
          aria-invalid={invalid}
          aria-describedby={`${nameId}-help`}
          onChange={(e) => onChange({ name: e.target.value })}
          onBlur={() => setTouched(true)}
          placeholder="Who are you today?"
          ref={inputRef}
          className={`w-full rounded-card border-2 bg-white px-3 py-3 text-lg font-semibold ${
            invalid ? 'border-cherry' : 'border-ink/15'
          }`}
        />
        {/*
          An invalid state has to LOOK different, not just reword itself. The
          previous copy swapped one grey sentence for another, so submitting an
          empty name read as the button doing nothing at all.
        */}
        <p
          id={`${nameId}-help`}
          className={invalid ? 'text-xs font-semibold text-cherry' : 'text-xs opacity-55'}
          {...(invalid ? { role: 'alert' } : {})}
        >
          {invalid ? 'Pick a name first — any name. It is thrown away when the room closes.' : 'Thrown away when the room closes.'}
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-mono text-[0.625rem] tracking-[0.16em] uppercase opacity-65">Avatar color</legend>
        <div className="flex flex-wrap gap-2">
          {AVATAR_COLORS.map((c) => {
            const selected = c.toUpperCase() === color.toUpperCase();
            return (
              <button
                key={c}
                type="button"
                aria-label={`Avatar color ${c}`}
                aria-pressed={selected}
                onClick={() => onChange({ color: c })}
                className={[
                  'h-10 w-10 rounded-full border-4 transition-transform',
                  selected ? 'scale-110 border-ink' : 'border-ink/12 hover:scale-105',
                ].join(' ')}
                style={{ background: c }}
              >
                {selected && (
                  <svg viewBox="0 0 24 24" className="mx-auto h-4 w-4" fill="none" stroke="#14121F" strokeWidth="3.5" aria-hidden="true">
                    <path d="M5 13l4 4 10-10" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </fieldset>

      <button
        type="submit"
        disabled={busy}
        className="rounded-full bg-fanta px-6 py-3.5 font-display text-lg font-bold text-ink shadow-pop disabled:opacity-50"
      >
        {busy ? 'One second…' : submitLabel}
      </button>
    </form>
  );
}

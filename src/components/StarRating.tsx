import { useState } from 'react';

/** Filled or hollow star. Decorative: the buttons carry the text labels. */
function Star({ filled }: { filled: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={`star${filled ? ' star--filled' : ''}`}
      viewBox="0 0 24 24"
      width="22"
      height="22"
    >
      <path
        d="M12 3.6l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.9l6-.8z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface StarRatingProps {
  value: number | null;
  /** Absent for a visitor: the rating is then shown, not set. */
  onChange?: ((value: number | null) => void) | undefined;
  busy?: boolean;
}

/**
 * The owner's 1–5 star rating, which also decides how large this cover is drawn
 * on the wall when it is arranged by rating.
 *
 * A radio group rather than five toggles: exactly one value is selected, and
 * arrow keys move between them for free. Pressing the current rating again
 * clears it.
 */
export function StarRating({ value, onChange, busy = false }: StarRatingProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const shown = hovered ?? value ?? 0;

  if (!onChange) {
    if (value === null) return null;
    return (
      <p className="star-rating star-rating--readonly">
        <span className="visually-hidden">Rated {value} of 5</span>
        {[1, 2, 3, 4, 5].map((star) => (
          <Star key={star} filled={star <= value} />
        ))}
      </p>
    );
  }

  return (
    <div
      className="star-rating"
      role="radiogroup"
      aria-label="Your rating"
      onPointerLeave={() => {
        setHovered(null);
      }}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${String(star)} star${star === 1 ? '' : 's'}`}
          className="star-rating__button"
          disabled={busy}
          onPointerEnter={() => {
            setHovered(star);
          }}
          onFocus={() => {
            setHovered(star);
          }}
          onBlur={() => {
            setHovered(null);
          }}
          onClick={() => {
            // Tapping the current rating again clears it, so a rating is never
            // a one-way door.
            onChange(value === star ? null : star);
          }}
        >
          <Star filled={star <= shown} />
        </button>
      ))}
      <span className="star-rating__hint" aria-hidden="true">
        {value === null ? 'Rate' : `${String(value)}/5`}
      </span>
    </div>
  );
}

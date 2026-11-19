import React from "react";
import { FiSearch, FiX } from "react-icons/fi";

/**
 * The log search box: a magnifier, the field, and the buttons that clear and submit it.
 *
 * ── WHY THIS IS A FLEX ROW AND NOT AN INPUT WITH THINGS ON TOP ───────────────
 * The obvious build is one `.shell-input` with the adornments absolutely positioned over it and
 * left/right padding reserved so the text clears them. That padding is a GUESS, and it has to be
 * re-guessed every time an adornment appears, disappears or changes size — the clear button here
 * only exists while there is something to clear, so the reservation changes as you type.
 *
 * Getting the guess wrong does not fail loudly; it just puts an icon on top of the text. That is
 * exactly what happened: the magnifier and the submit button ended up in the same corner, drawn
 * over each other.
 *
 * So the box is a flex ROW (`.shell-field` in index.css) and the input is one item in it. The
 * browser does the arithmetic, and no amount of resizing or state can make two of these overlap.
 * The focus ring lives on `:focus-within` so the whole field lights up as one control.
 *
 * ── SEPARATE FROM THE PAGE SO IT CAN BE TESTED ───────────────────────────────
 * A layout bug is invisible to a type checker and to every test that only asks what the page
 * fetched. Its own component means its own render test, which pins the structure that makes the
 * overlap impossible — see ./LogSearchField.test.tsx.
 */
const LogSearchField: React.FC<{
  value: string;
  onChange: (value: string) => void;
  /** Run the search — the button, and Enter. */
  onSubmit: () => void;
  /** Empty the box AND drop the applied search, so the table goes back to everything. */
  onClear: () => void;
  placeholder: string;
}> = ({ value, onChange, onSubmit, onClear, placeholder }) => (
  <div className="shell-field min-w-60 max-w-md flex-1">
    {/* Decorative: the field already has an accessible name, and a second "search" for a screen
        reader to read out would be noise. */}
    <FiSearch size={13} aria-hidden className="ink-3 shrink-0" />
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSubmit();
        // Escape empties the box, which is what every search field does and what someone reaches
        // for before hunting on screen for the little cross.
        if (e.key === "Escape" && value) onClear();
      }}
      placeholder={placeholder}
      aria-label="Search the log"
    />
    {/* Only while there is something to clear. This is the adornment whose coming and going broke
        the padding-based layout. */}
    {value && (
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear the search"
        className="btn-icon h-6 w-6 shrink-0"
      >
        <FiX size={12} />
      </button>
    )}
    <button
      type="button"
      onClick={onSubmit}
      aria-label="Run the search"
      className="btn-icon h-6 w-6 shrink-0"
    >
      <FiSearch size={12} />
    </button>
  </div>
);

export default LogSearchField;

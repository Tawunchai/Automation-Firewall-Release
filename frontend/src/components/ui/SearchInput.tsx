import React from "react";
import { FiSearch } from "react-icons/fi";

interface SearchInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Tailwind width class. Lists with long names get a wider box. */
  width?: string;
}

/**
 * The list-filter box that sits in a page header, next to "Create new".
 *
 * One component rather than a copy per page: every list page had its own, and they had drifted to
 * three widths, two heights and two different magnifier glyphs (one an inline `<svg>` typed out by
 * hand). Consistency here is the whole point — this control appears on every list in the console,
 * so any difference between two of them reads as an accident.
 */
const SearchInput: React.FC<SearchInputProps> = ({
  value, onChange, placeholder = "Search…", width = "w-52",
}) => (
  <div className={`relative ${width}`}>
    <FiSearch
      size={13}
      className="ink-3 pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
    />
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      // .shell-input carries the surface, the focus ring and the placeholder colour, so the accent
      // is applied by CSS rather than by an onFocus handler writing inline styles.
      className="shell-input h-8.5 py-0 pl-8.5"
    />
  </div>
);

export default SearchInput;

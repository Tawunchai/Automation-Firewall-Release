// LANGUAGE_OPTIONS: the languages the switcher offers, and their labels.
//
// Data, not a component — and read by more than the switcher.//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else: the whole module reloads instead of re-rendering, and every
// piece of state in it is lost on each save.

import flagEN from "../../../assets/flags/english.png";
import flagTH from "../../../assets/flags/thai.png";
import flagZH from "../../../assets/flags/china.png";

export type LanguageCode = "en" | "th" | "zh";

export type LanguageOption = {
  value: LanguageCode;
  /** The language's name in itself — how a language picker is conventionally labelled. */
  nativeName: string;
  englishName: string;
  flag: string;
};

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: "en", nativeName: "English",  englishName: "English", flag: flagEN },
  { value: "th", nativeName: "ภาษาไทย",   englishName: "Thai",    flag: flagTH },
  { value: "zh", nativeName: "中文",       englishName: "Chinese", flag: flagZH },
];

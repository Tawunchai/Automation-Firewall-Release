import React, { useCallback, useEffect, useState } from "react";
import i18next from "i18next";
import { getLang, setLang as setLangGlobal, subscribeLang, type Lang } from "./lang";
import { ensureLanguage } from "./translate";
import { LanguageContext } from "./LanguageProvider.logic";

const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Lang>(getLang);

  // The store can be written from outside React (and is, by anything that is not a component), so
  // the component follows it rather than the other way round.
  useEffect(() => subscribeLang(setLangState), []);

  useEffect(() => {
    if (i18next.language !== lang) void i18next.changeLanguage(lang);
  }, [lang]);

  // The dictionary is fetched before the language changes, never after. Switching first would
  // remount the whole tree (see THE REMOUNT above) against a table that has not arrived, so every
  // page would repaint in English and then repaint again a moment later in the language that was
  // asked for — two full remounts to arrive where one would have done. ensureLanguage resolves
  // immediately for a language already in memory, so switching back is instant.
  const setLang = useCallback((next: Lang) => {
    void ensureLanguage(next).then(() => setLangGlobal(next));
  }, []);

  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      <React.Fragment key={lang}>{children}</React.Fragment>
    </LanguageContext.Provider>
  );
};

export default LanguageProvider;

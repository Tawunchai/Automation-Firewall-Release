import ConfigRoutes from "./routes/mainroutes";
import LanguageProvider from "./i18n/LanguageProvider";
import { ContextProvider } from "./contexts/ProviderContext";
import { AuthProvider } from "./contexts/AuthContext";
import { AiJobProvider } from "./contexts/AiJobContext";

// The app root deliberately imports NO component library.
//
// It used to wrap everything in Ant Design's ConfigProvider, which meant the whole 935 KB library
// sat in the critical path for every page — including the ~30 that no longer use a single antd
// component. The console is styled by index.css now; the three pages that still render antd
// widgets provide the theme themselves via components/ui/AntdScope, so the library loads with
// those pages and with nothing else.

const App: React.FC = () => (
  // Outermost, because switching language remounts everything below it (see LanguageProvider) and
  // the providers under here hold nothing that should survive that - the auth session and the
  // in-flight AI job live in their own stores, not in this tree's state.
  <LanguageProvider>
    <ContextProvider>
      <AuthProvider>
        {/* Above the router on purpose: an AI request takes ~30s, and it used to be cancelled by
            the act of walking to another page. Here it outlives the page that asked for it. */}
        <AiJobProvider>
          <ConfigRoutes />
        </AiJobProvider>
      </AuthProvider>
    </ContextProvider>
  </LanguageProvider>
);

export default App;

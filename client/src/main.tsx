import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { startPwa } from "./lib/pwa";

// The app used hash routing before (militaryvoices.ai/#/agenda). Links that were
// already shared keep working: translate a legacy hash path into a real path,
// both on first load and if a hash link is followed inside the running app.
function upgradeLegacyHashRoute() {
  if (window.location.hash.startsWith("#/")) {
    const legacy = window.location.hash.slice(1);
    window.history.replaceState(null, "", legacy + window.location.search);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
}
upgradeLegacyHashRoute();
window.addEventListener("hashchange", upgradeLegacyHashRoute);

// The installable app: keep the install offer, register the service worker.
startPwa();

createRoot(document.getElementById("root")!).render(<App />);

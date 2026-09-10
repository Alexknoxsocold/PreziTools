import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./mobile-nav-fixes.css";
import "./market-tabs.css";
import "./mobile-category-tabs.css";
import "./mlb-mobile-target.css";
import "./mlb-copy-cleanup.css";
import "./nfl-mobile-inset.css";
import "./mobile-primary-nav-compact.css";
import "./wnba-arena-backdrops.css";
import "./wnba-props-hide.css";

createRoot(document.getElementById("root")!).render(<App />);

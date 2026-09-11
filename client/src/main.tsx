import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./mobile-nav-fixes.css";
import "./market-tabs.css";
import "./mobile-category-tabs.css";
import "./mlb-mobile-target.css";
import "./mlb-copy-cleanup.css";
import "./mlb-game-popup.css";
import "./nfl-mobile-inset.css";
import "./mobile-primary-nav-compact.css";
import "./wnba-arena-backdrops.css";
import "./wnba-props-hide.css";

createRoot(document.getElementById("root")!).render(<App />);

function installMlbGamePopup() {
  let previousOverflow = "";

  const closePopup = () => {
    const popup = document.getElementById("mlb-game-popup");
    if (!popup) return;
    popup.remove();
    document.body.style.overflow = previousOverflow;
  };

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePopup();
  });

  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("#mlb-game-popup")) return;

    const card = target.closest<HTMLElement>('[data-testid^="card-nrfi-"]');
    if (!card) return;

    event.preventDefault();

    const backdrop = document.createElement("div");
    backdrop.id = "mlb-game-popup";
    backdrop.className = "mlb-game-popup-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-label", "MLB game details");

    const stage = document.createElement("div");
    stage.className = "mlb-game-popup-stage";
    stage.addEventListener("click", (e) => e.stopPropagation());

    const close = document.createElement("button");
    close.type = "button";
    close.className = "mlb-game-popup-close";
    close.setAttribute("aria-label", "Close game details");
    close.textContent = "×";
    close.addEventListener("click", closePopup);

    const clone = card.cloneNode(true) as HTMLElement;
    clone.removeAttribute("tabindex");
    clone.removeAttribute("role");

    stage.appendChild(close);
    stage.appendChild(clone);
    backdrop.appendChild(stage);
    backdrop.addEventListener("click", closePopup);

    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.appendChild(backdrop);
    close.focus();
  });
}

installMlbGamePopup();

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

function installMlbTeamLogoFallbacks() {
  const espnCode: Record<string, string> = {
    ARI: "ari", ATL: "atl", BAL: "bal", BOS: "bos", CHC: "chc", CHW: "chw", CWS: "chw",
    CIN: "cin", CLE: "cle", COL: "col", DET: "det", HOU: "hou", KC: "kc", KCR: "kc",
    LAA: "laa", LAD: "lad", MIA: "mia", MIL: "mil", MIN: "min", NYM: "nym", NYY: "nyy",
    OAK: "oak", ATH: "oak", PHI: "phi", PIT: "pit", SD: "sd", SDP: "sd", SEA: "sea",
    SF: "sf", SFG: "sf", STL: "stl", TB: "tb", TBR: "tb", TEX: "tex", TOR: "tor",
    WSH: "wsh", WAS: "wsh"
  };

  const upgrade = (root: ParentNode) => {
    root.querySelectorAll<HTMLElement>('[data-testid^="card-nrfi-"] span').forEach((span) => {
      if (!span.classList.contains("w-8") || !span.classList.contains("h-8") || !span.classList.contains("rounded-full")) return;
      const abbr = (span.textContent ?? "").trim().toUpperCase();
      const code = espnCode[abbr];
      if (!code) return;

      const img = document.createElement("img");
      img.src = `https://a.espncdn.com/i/teamlogos/mlb/500/${code}.png`;
      img.alt = `${abbr} logo`;
      img.className = "w-8 h-8 object-contain shrink-0";
      img.decoding = "async";
      img.loading = "lazy";
      img.onerror = () => {
        img.replaceWith(span);
      };
      span.replaceWith(img);
    });
  };

  upgrade(document);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) upgrade(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

installMlbGamePopup();
installMlbTeamLogoFallbacks();

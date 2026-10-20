import { useState } from "react";
import { BarChart2, LayoutGrid, Users } from "lucide-react";
import AllGames from "@/pages/AllGames";
import PlayerStats from "@/pages/PlayerStats";
import FirstBasketHistory from "@/pages/FirstBasketHistory";
import ProjectedLineups from "@/pages/ProjectedLineups";

type NbaSection = "games" | "projected-lineups" | "player-stats" | "fb-history";

export default function NBA() {
  const [section, setSection] = useState<NbaSection>("player-stats");

  const tabClass = (active: boolean) => `min-h-12 flex items-center gap-1.5 px-4 pt-4 pb-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"}`;

  return (
    <div className="-mx-4 md:-mx-6 lg:-mx-8 -mt-8">
      <nav className="border-b bg-card pt-1" aria-label="NBA sections">
        <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8">
          <div className="flex items-center gap-0 overflow-x-auto">
            <button type="button" onClick={() => setSection("games")} className={tabClass(section === "games")} aria-current={section === "games" ? "page" : undefined} data-testid="tab-nba-games">
              <LayoutGrid className={`w-3.5 h-3.5 ${section === "games" ? "text-primary" : ""}`} aria-hidden="true" />
              Opening Tips
            </button>
            <button type="button" onClick={() => setSection("player-stats")} className={tabClass(section === "player-stats")} aria-current={section === "player-stats" ? "page" : undefined} data-testid="tab-nba-player-fb-stats">
              <BarChart2 className={`w-3.5 h-3.5 ${section === "player-stats" ? "text-primary" : ""}`} aria-hidden="true" />
              First Baskets
            </button>
            <button type="button" onClick={() => setSection("projected-lineups")} className={tabClass(section === "projected-lineups")} aria-current={section === "projected-lineups" ? "page" : undefined} data-testid="tab-nba-projected-lineups">
              <Users className={`w-3.5 h-3.5 ${section === "projected-lineups" ? "text-primary" : ""}`} aria-hidden="true" />
              Projected Lineups
            </button>
          </div>
        </div>
      </nav>

      <div className="pt-8">
        {section === "games" && <AllGames />}
        {section === "player-stats" && <PlayerStats />}
        {section === "fb-history" && <FirstBasketHistory />}
        {section === "projected-lineups" && <ProjectedLineups />}
      </div>
    </div>
  );
}
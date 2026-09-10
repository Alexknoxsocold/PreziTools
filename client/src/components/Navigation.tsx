import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";

const navItems = [
  { label: "Best Plays", path: "/", icon: "sparkles", glow: "nav-glow-best" },
  { label: "NBA", path: "/nba", icon: "🏀", glow: "nav-glow-nba" },
  { label: "WNBA", path: "/wnba", icon: "🏀", glow: "nav-glow-wnba" },
  { label: "MLB", path: "/mlb", icon: "⚾", glow: "nav-glow-mlb" },
  { label: "NFL", path: "/nfl", icon: "🏈", glow: "nav-glow-nfl" },
  { label: "NHL", path: "/nhl", icon: "🏒", glow: "nav-glow-nhl" },
];

export default function Navigation() {
  const [location] = useLocation();

  return (
    <nav className="site-sports-nav border-b bg-card sticky top-14 z-40" aria-label="Primary sports navigation">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 lg:px-8">
        <div className="flex items-center gap-1 overflow-x-auto overscroll-x-contain py-1.5 scrollbar-none">
          {navItems.map((item) => {
            const isActive = location === item.path || (item.path !== "/" && location.startsWith(`${item.path}/`));
            return (
              <Link key={item.path} href={item.path}>
                <span
                  className={cn(
                    "sport-nav-tab min-h-10 flex items-center gap-1.5 rounded-lg px-3 sm:px-4 py-2 text-[11px] sm:text-xs font-semibold whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    item.glow,
                    isActive ? "sport-nav-active" : "text-muted-foreground"
                  )}
                  aria-current={isActive ? "page" : undefined}
                  data-testid={`link-nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  {item.icon === "sparkles" ? (
                    <Sparkles aria-hidden="true" className="w-3.5 h-3.5" />
                  ) : (
                    <span aria-hidden="true" className="text-[15px] leading-none">{item.icon}</span>
                  )}
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

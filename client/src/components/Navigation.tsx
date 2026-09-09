import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { LayoutGrid, CircleDot, Trophy, Goal, Sparkles } from "lucide-react";

const navItems = [
  { label: "Best Plays", path: "/", icon: Sparkles },
  { label: "NBA", path: "/nba", icon: LayoutGrid },
  { label: "WNBA", path: "/wnba", icon: Trophy },
  { label: "MLB", path: "/mlb", icon: CircleDot },
  { label: "NFL", path: "/nfl", icon: Goal },
  { label: "NHL", path: "/nhl", icon: CircleDot },
];

export default function Navigation() {
  const [location] = useLocation();

  return (
    <nav className="border-b bg-card sticky top-14 z-40" aria-label="Primary sports navigation">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 lg:px-8">
        <div className="flex items-center gap-1 overflow-x-auto overscroll-x-contain py-1.5 scrollbar-none">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.path || (item.path !== "/" && location.startsWith(`${item.path}/`));
            return (
              <Link key={item.path} href={item.path}>
                <span
                  className={cn(
                    "min-h-10 flex items-center gap-1.5 rounded-lg px-3 sm:px-4 py-2 text-[11px] sm:text-xs font-semibold transition-all whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive
                      ? "bg-primary/15 text-primary ring-1 ring-primary/25 shadow-sm"
                      : "text-muted-foreground hover:bg-primary/10 hover:text-primary"
                  )}
                  aria-current={isActive ? "page" : undefined}
                  data-testid={`link-nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  <Icon aria-hidden="true" className="w-3.5 h-3.5" />
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

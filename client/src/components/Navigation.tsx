import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";

function BasketballIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3c2.2 2.6 3.3 5.6 3.3 9S14.2 18.4 12 21M12 3C9.8 5.6 8.7 8.6 8.7 12s1.1 6.4 3.3 9M3.4 9.2c2.6.8 5.5 1.2 8.6 1.2s6-.4 8.6-1.2M3.4 14.8c2.6-.8 5.5-1.2 8.6-1.2s6 .4 8.6 1.2"/></svg>;
}

function BaseballIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M7.1 4.5c1.7 1.7 2.6 3.8 2.6 6.2s-.9 4.5-2.6 6.2M16.9 7.1c-1.7 1.7-2.6 3.8-2.6 6.2s.9 4.5 2.6 6.2"/><path d="m8.3 7.5-1.5.4m2.1 2.2-1.6.2m8.4 6.2 1.5-.4m-2.1-2.2 1.6-.2"/></svg>;
}

function FootballIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><path d="M19.8 4.2c-3.1-3.1-9.2-.8-12.7 2.7S1.3 16.5 4.2 19.8c3.1 3.1 9.2.8 12.7-2.7s5.8-9.6 2.9-12.9Z"/><path d="m8.5 15.5 7-7m-4.8 4.8-2-2m4.6.6-2-2m4.6.6-2-2"/></svg>;
}

function HockeyIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><path d="m15.8 3-2.7 11.2c-.4 1.6-1.8 2.8-3.5 2.8H5.5c-1.4 0-2.5 1.1-2.5 2.5S4.1 22 5.5 22h5.1c3.4 0 6.4-2.3 7.2-5.6L21 3"/><ellipse cx="18.5" cy="20" rx="2.5" ry="1.2"/></svg>;
}

type SportIcon = "best" | "basketball" | "baseball" | "football" | "hockey";
const navItems: { label: string; path: string; icon: SportIcon; glow: string }[] = [
  { label: "Best Plays", path: "/", icon: "best", glow: "nav-glow-best" },
  { label: "NBA", path: "/nba", icon: "basketball", glow: "nav-glow-nba" },
  { label: "WNBA", path: "/wnba", icon: "basketball", glow: "nav-glow-wnba" },
  { label: "MLB", path: "/mlb", icon: "baseball", glow: "nav-glow-mlb" },
  { label: "NFL", path: "/nfl", icon: "football", glow: "nav-glow-nfl" },
  { label: "NHL", path: "/nhl", icon: "hockey", glow: "nav-glow-nhl" },
];

function NavIcon({ type }: { type: SportIcon }) {
  const className = "w-4 h-4 shrink-0";
  if (type === "basketball") return <BasketballIcon className={className}/>;
  if (type === "baseball") return <BaseballIcon className={className}/>;
  if (type === "football") return <FootballIcon className={className}/>;
  if (type === "hockey") return <HockeyIcon className={className}/>;
  return <Sparkles aria-hidden="true" className={className}/>;
}

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
                <span className={cn("sport-nav-tab min-h-10 flex items-center gap-1.5 rounded-lg px-3 sm:px-4 py-2 text-[11px] sm:text-xs font-semibold whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",item.glow,isActive ? "sport-nav-active" : "text-muted-foreground")} aria-current={isActive ? "page" : undefined} data-testid={`link-nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}>
                  <NavIcon type={item.icon}/>{item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

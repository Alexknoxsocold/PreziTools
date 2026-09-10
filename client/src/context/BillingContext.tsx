import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";

export type BillingStatus = {
  authenticated: boolean;
  plan: "free" | "pro";
  pro: boolean;
  status?: string;
  renewalPeriodEnd?: string | null;
  updatedAt?: string | null;
};

type BillingContextType = BillingStatus & {
  isLoading: boolean;
  refresh: () => Promise<void>;
  startCheckout: () => Promise<void>;
};

const defaultStatus: BillingStatus = {
  authenticated: false,
  plan: "free",
  pro: false,
  status: "inactive",
  renewalPeriodEnd: null,
  updatedAt: null,
};

const BillingContext = createContext<BillingContextType | null>(null);

export function BillingProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const [status, setStatus] = useState<BillingStatus>(defaultStatus);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = async () => {
    if (!user) {
      setStatus(defaultStatus);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/billing/status", {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Billing status request failed (${response.status})`);
      const data = await response.json();
      setStatus({
        authenticated: Boolean(data.authenticated),
        plan: data.pro ? "pro" : "free",
        pro: Boolean(data.pro),
        status: typeof data.status === "string" ? data.status : "inactive",
        renewalPeriodEnd: typeof data.renewalPeriodEnd === "string" ? data.renewalPeriodEnd : null,
        updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
      });
    } catch (error) {
      console.error("Failed to load billing status:", error);
      setStatus({ ...defaultStatus, authenticated: true });
    } finally {
      setIsLoading(false);
    }
  };

  const startCheckout = async () => {
    const response = await fetch("/api/billing/checkout-url", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Checkout request failed (${response.status})`);
    const data = await response.json();
    if (!data?.url) throw new Error("Checkout URL missing");
    window.location.assign(data.url);
  };

  useEffect(() => {
    if (authLoading) return;
    void refresh();
  }, [authLoading, user?.id]);

  const value = useMemo(() => ({ ...status, isLoading, refresh, startCheckout }), [status, isLoading]);
  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}

export function useBilling() {
  const context = useContext(BillingContext);
  if (!context) throw new Error("useBilling must be used within BillingProvider");
  return context;
}

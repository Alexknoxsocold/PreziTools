import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import "@/model-signals.css"

const badgeVariants = cva(
  // Whitespace-nowrap: Badges should never wrap.
  "whitespace-nowrap inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2" +
  " hover-elevate " ,
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground shadow-xs",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground shadow-xs",

        outline: " border [border-color:var(--badge-outline)] shadow-xs",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function badgeText(children: React.ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(badgeText).join(" ");
  return "";
}

function modelSignalClass(children: React.ReactNode): string {
  const label = badgeText(children).trim().toUpperCase().replace(/\s+/g, " ");
  if (["OFFICIAL PLAY", "TOP PLAY", "BEST PLAY", "STRONG PLAY", "PLAY", "POWER PLAY"].includes(label)) return "model-signal-live model-signal-strong";
  if (["MODEL LEAN", "LEAN", "VALUE", "VALUE PRICE", "STRONG", "WATCH"].includes(label)) return "model-signal-live model-signal-value";
  return "";
}

function Badge({ className, variant, children, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), modelSignalClass(children), className)} {...props}>{children}</div>
  );
}

export { Badge, badgeVariants }

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none", {
  variants: {
    variant: {
      default: "bg-primary/20 text-primary",
      secondary: "bg-secondary text-muted-foreground",
      gold: "bg-gold/15 text-gold",
      success: "bg-emerald-500/15 text-emerald-400",
      destructive: "bg-destructive/15 text-destructive",
      outline: "border border-border text-muted-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

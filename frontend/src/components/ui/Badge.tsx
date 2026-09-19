import type { HTMLAttributes } from "react";
import { cn } from "@/utils/cn";

export type Tone = "neutral" | "brand" | "ok" | "warn" | "err";

const TONE: Record<Tone, string> = {
  neutral: "chip-neutral",
  brand: "chip-brand",
  ok: "chip-ok",
  warn: "chip-warn",
  err: "chip-err",
};

const DOT: Record<Tone, string> = {
  neutral: "bg-ink-400",
  brand: "bg-brand-500",
  ok: "bg-ok-500",
  warn: "bg-warn-500",
  err: "bg-err-500",
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  dot?: boolean;
  pulse?: boolean;
}

export function Badge({ tone = "neutral", dot, pulse, className, children, ...rest }: BadgeProps) {
  return (
    <span className={cn("chip", TONE[tone], className)} {...rest}>
      {dot && (
        <span className="relative flex h-1.5 w-1.5">
          {pulse && (
            <span
              className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", DOT[tone])}
            />
          )}
          <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", DOT[tone])} />
        </span>
      )}
      {children}
    </span>
  );
}

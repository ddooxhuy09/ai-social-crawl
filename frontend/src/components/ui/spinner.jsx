import { cn } from "../../lib/utils";

/** Simple spinner using CSS border trick. Pass `borderTopColor` via style to set the spin color. */
export function Spinner({ className, color = "#0ea5e9", size = 40 }) {
  return (
    <div
      className={cn("rounded-full border-[3px] border-gray-200 animate-spin shrink-0", className)}
      style={{ width: size, height: size, borderTopColor: color }}
    />
  );
}

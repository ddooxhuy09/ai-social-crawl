import { cn } from "../../lib/utils";

export function Select({ className, children, ...props }) {
  return (
    <select
      className={cn(
        "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent disabled:opacity-50 cursor-pointer",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

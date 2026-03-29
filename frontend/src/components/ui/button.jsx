import { cn } from "../../lib/utils";

const variantClasses = {
  default:       "bg-zinc-900 text-white hover:bg-zinc-700",
  outline:       "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
  ghost:         "text-gray-600 hover:bg-gray-100",
  sky:           "bg-sky-500 text-white hover:bg-sky-600",
  emerald:       "bg-emerald-500 text-white hover:bg-emerald-600",
  violet:        "bg-violet-500 text-white hover:bg-violet-600",
  rose:          "bg-rose-500 text-white hover:bg-rose-600",
  pink:          "bg-pink-500 text-white hover:bg-pink-600",
  danger:        "bg-red-500 text-white hover:bg-red-600",
  pinterest:     "bg-[#e60023] text-white hover:bg-[#c0001d]",
  "outline-sky": "border border-sky-300 bg-sky-50 text-sky-600 hover:bg-sky-100",
  "outline-red": "border border-red-200 bg-red-50 text-red-600 hover:bg-red-100",
};

const sizeClasses = {
  xs: "px-2.5 py-1 text-xs h-6",
  sm: "px-3 py-1.5 text-xs h-7",
  md: "px-4 py-2 text-sm h-9",
  lg: "px-5 py-2.5 text-sm h-10",
};

export function Button({ variant = "default", size = "md", className, ...props }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center font-medium rounded-full transition-colors cursor-pointer focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed",
        variantClasses[variant] ?? variantClasses.default,
        sizeClasses[size] ?? sizeClasses.md,
        className
      )}
      {...props}
    />
  );
}

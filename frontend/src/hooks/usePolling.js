import { useEffect, useRef } from "react";

/**
 * Generic polling hook. Calls `fn` on an `intervalMs` cadence.
 *
 * @param {Function} fn          - The function to call on each tick.
 * @param {number}   intervalMs  - Interval in milliseconds.
 * @param {Array}    dependencies - When any dep changes the interval is torn down
 *                                  and restarted (same semantics as useEffect deps).
 *                                  Pass `[]` (default) to never restart.
 */
export function usePolling(fn, intervalMs, dependencies = []) {
  // Always call the latest version of fn without restarting the interval.
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const id = setInterval(() => fnRef.current(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, ...dependencies]);
}

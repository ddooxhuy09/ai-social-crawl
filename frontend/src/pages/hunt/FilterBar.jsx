import React from "react";
import { HUNT_FILTERS } from "../../constants";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

export default function FilterBar({
  huntFilters, setHuntFilters,
  huntOpenFilter, setHuntOpenFilter,
  huntDraft, setHuntDraft,
  huntActiveFilterCount,
  filtersConfig,
}) {
  const config = filtersConfig || HUNT_FILTERS;

  const fmtVal = (v) => {
    if (v == null) return "";
    if (v >= 1e6) return `${(v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(v % 1e3 === 0 ? 0 : 1)}K`;
    return v.toLocaleString();
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2.5 mb-3">
      {huntActiveFilterCount > 0 && (
        <div className="flex flex-wrap gap-1.5 items-center mb-2">
          <span className="text-xs font-semibold text-gray-700">Selected:</span>
          {Object.entries(huntFilters).map(([key, [min, max]]) => {
            const label = config.flatMap((g) => g.rows).find((r) => r.key === key)?.label || key;
            const rangeText = min == null ? `< ${fmtVal(max)}` : max == null ? `≥ ${fmtVal(min)}` : `${fmtVal(min)}~${fmtVal(max)}`;
            return (
              <span key={key} className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 rounded px-2 py-0.5 text-xs text-blue-700">
                {label}: {rangeText}
                <span
                  onClick={() => setHuntFilters((f) => { const n = { ...f }; delete n[key]; return n; })}
                  className="cursor-pointer font-bold text-blue-300 hover:text-blue-600 ml-0.5"
                >×</span>
              </span>
            );
          })}
          <span onClick={() => setHuntFilters({})} className="text-xs text-red-500 cursor-pointer hover:text-red-700 ml-1">Clear all</span>
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs font-semibold text-gray-700">Filters:</span>
        {config.map((fg) => {
          const isOpen = huntOpenFilter === fg.group;
          const hasActive = fg.rows.some((r) => huntFilters[r.key]);
          return (
            <div key={fg.group} className="relative">
              <Button
                variant={hasActive ? "outline-blue" : "outline"}
                type="button"
                onClick={() => {
                  if (isOpen) { setHuntOpenFilter(null); return; }
                  const draft = {};
                  fg.rows.forEach((r) => {
                    if (huntFilters[r.key]) draft[r.key] = [...huntFilters[r.key]];
                    draft[r.key + "_cmin"] = "";
                    draft[r.key + "_cmax"] = "";
                  });
                  setHuntDraft(draft);
                  setHuntOpenFilter(fg.group);
                }}
                className={`flex items-center gap-1 px-3 py-1 h-auto rounded text-xs transition-colors ${hasActive ? "border-blue-400 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800" : "bg-white text-gray-700 hover:bg-gray-50"}`}
              >
                {fg.label}
                <span className={`text-[0.55rem] transition-transform ${isOpen ? "rotate-180" : ""}`}>▼</span>
              </Button>

              {isOpen && (
                <div className="absolute top-full left-0 mt-1 z-[100] bg-white border border-gray-200 rounded-lg shadow-lg p-3 min-w-[340px]">
                  <p className="text-sm font-semibold mb-1.5">{fg.label}</p>
                  <div className="h-px bg-gray-200 mb-2.5" />
                  {fg.rows.map((row) => {
                    const activePreset = huntDraft[row.key];
                    const isAll = !activePreset && !huntDraft[row.key + "_cmin"] && !huntDraft[row.key + "_cmax"];
                    return (
                      <div key={row.key} className="mb-2.5">
                        <p className="text-xs text-gray-400 mb-1.5">{row.label}:</p>
                        <div className="flex flex-wrap gap-1 mb-1.5">
                          <Button
                            variant={isAll ? "sky" : "outline"}
                            type="button"
                            onClick={() => setHuntDraft((d) => { const n = { ...d }; delete n[row.key]; n[row.key + "_cmin"] = ""; n[row.key + "_cmax"] = ""; return n; })}
                            className={`px-2.5 py-0.5 h-auto rounded border text-xs transition-colors`}
                          >All</Button>
                          {row.presets.map(([pmin, pmax, plabel]) => {
                            const sel = activePreset && activePreset[0] === pmin && activePreset[1] === pmax;
                            return (
                              <Button
                                variant={sel ? "sky" : "outline"}
                                key={plabel} type="button"
                                onClick={() => setHuntDraft((d) => ({ ...d, [row.key]: [pmin, pmax], [row.key + "_cmin"]: "", [row.key + "_cmax"]: "" }))}
                                className={`px-2.5 py-0.5 h-auto rounded border text-xs transition-colors`}
                              >{plabel}</Button>
                            );
                          })}
                        </div>
                        <div className="flex items-center gap-1">
                          <Input type="number" placeholder="Min" value={huntDraft[row.key + "_cmin"] ?? ""}
                            onChange={(e) => setHuntDraft((d) => ({ ...d, [row.key + "_cmin"]: e.target.value, [row.key]: null }))}
                            className="w-20 px-2 h-auto py-1 rounded text-xs" />
                          <span className="text-xs text-gray-400">~</span>
                          <Input type="number" placeholder="Max" value={huntDraft[row.key + "_cmax"] ?? ""}
                            onChange={(e) => setHuntDraft((d) => ({ ...d, [row.key + "_cmax"]: e.target.value, [row.key]: null }))}
                            className="w-20 px-2 h-auto py-1 rounded text-xs" />
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex justify-end gap-1.5 mt-2 pt-2 border-t border-gray-200">
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() => {
                        const draft = {};
                        fg.rows.forEach((r) => { draft[r.key + "_cmin"] = ""; draft[r.key + "_cmax"] = ""; });
                        setHuntDraft(draft);
                      }}
                      className="px-2.5 h-auto py-1 text-xs text-gray-500 hover:text-gray-800"
                    >Reset</Button>
                    <Button variant="outline" type="button" onClick={() => setHuntOpenFilter(null)}
                      className="px-3 py-1 h-auto rounded text-xs">Cancel</Button>
                    <Button
                      variant="sky"
                      type="button"
                      onClick={() => {
                        const newFilters = { ...huntFilters };
                        fg.rows.forEach((r) => {
                          const cmin = huntDraft[r.key + "_cmin"];
                          const cmax = huntDraft[r.key + "_cmax"];
                          if (cmin || cmax) {
                            const mn = cmin ? parseFloat(cmin) : null;
                            const mx = cmax ? parseFloat(cmax) : null;
                            if (mn != null || mx != null) newFilters[r.key] = [mn, mx];
                            else delete newFilters[r.key];
                          } else if (huntDraft[r.key]) {
                            newFilters[r.key] = huntDraft[r.key];
                          } else {
                            delete newFilters[r.key];
                          }
                        });
                        setHuntFilters(newFilters);
                        setHuntOpenFilter(null);
                      }}
                      className="px-3 py-1 h-auto rounded text-xs"
                    >OK</Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

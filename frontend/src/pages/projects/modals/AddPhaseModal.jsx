import React from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { PHASE_TEMPLATES } from "../constants";

export default function AddPhaseModal({ open, onClose, onAddTemplate, onAddCustom, customPhaseName, setCustomPhaseName, customPhaseIcon, setCustomPhaseIcon }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[9998] bg-black/40 flex items-center justify-center"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-[440px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <p className="text-base font-semibold text-gray-900">Thêm phase</p>
          <button type="button" onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-lg cursor-pointer px-1">×</button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Template có sẵn</p>
            <div className="flex flex-col gap-1.5">
              {PHASE_TEMPLATES.map(tpl => (
                <button key={tpl.key} type="button" onClick={() => onAddTemplate(tpl)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-left cursor-pointer">
                  <span className="text-lg">{tpl.icon}</span>
                  <span className="text-sm font-medium text-gray-700">{tpl.name}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Tùy chỉnh</p>
            <div className="flex gap-2 mb-2">
              <Input value={customPhaseIcon} onChange={e => setCustomPhaseIcon(e.target.value)}
                className="w-14 text-center text-lg" maxLength={2} />
              <Input value={customPhaseName} onChange={e => setCustomPhaseName(e.target.value)}
                placeholder="Tên phase..." onKeyDown={e => e.key === "Enter" && onAddCustom()} />
            </div>
            <Button size="sm" variant="outline" onClick={onAddCustom} disabled={!customPhaseName.trim()}>
              + Thêm phase tùy chỉnh
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

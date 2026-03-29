import React from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";

export default function CreateProjectModal({ open, onClose, onSave, newName, setNewName, newDesc, setNewDesc, newPhases, setNewPhases }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[9998] bg-black/40 flex items-center justify-center"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-[520px] max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <p className="text-base font-semibold text-gray-900">Tạo project mới</p>
          <button type="button" onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-lg cursor-pointer px-1">×</button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">
          <div>
            <Label>Tên project <span className="text-red-500">*</span></Label>
            <Input value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="VD: Bunny Crochet — tháng 3/2026"
              onKeyDown={e => e.key === "Enter" && onSave()} autoFocus />
          </div>
          <div>
            <Label>Mô tả (tuỳ chọn)</Label>
            <Input value={newDesc} onChange={e => setNewDesc(e.target.value)}
              placeholder="Mô tả ngắn về project..." />
          </div>
          <div>
            <Label>Chọn các phase</Label>
            <div className="flex flex-col gap-2 mt-2">
              {newPhases.map((tpl, i) => (
                <label key={tpl.key} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={tpl.selected}
                    onChange={() => setNewPhases(prev => prev.map((t, j) => j === i ? { ...t, selected: !t.selected } : t))}
                    className="cursor-pointer accent-sky-500"
                  />
                  <span className="text-sm">{tpl.icon} {tpl.name}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <Button variant="outline" onClick={onClose}>Hủy</Button>
          <Button variant="default" onClick={onSave} disabled={!newName.trim()}>Tạo project</Button>
        </div>
      </div>
    </div>
  );
}

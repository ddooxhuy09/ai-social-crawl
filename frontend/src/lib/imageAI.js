/**
 * Shared API helpers for AI image generation workflow.
 * Used by ChatCreateImagePage and RedesignPhase.
 */
import { API_BASE } from "../constants";

export async function getImageAttributes(images, imageNames, description) {
  const r = await fetch(`${API_BASE}/api/generate-image/attributes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images, image_names: imageNames, description: description || undefined }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.detail || "Lỗi phân tích ảnh");
  return data; // { rows, image_names }
}

export async function buildImagePrompts(rows, imageNames) {
  const r = await fetch(`${API_BASE}/api/generate-image/build-prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attribute_table: rows, image_names: imageNames }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.detail || "Lỗi build prompt");
  return data.prompts || [];
}

export async function generateImages(prompt, numImages = 1) {
  const r = await fetch(`${API_BASE}/api/generate-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, model: "imagen-3.0-generate-002", num_images: numImages }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.detail || "Lỗi generate image");
  return data.images || [];
}



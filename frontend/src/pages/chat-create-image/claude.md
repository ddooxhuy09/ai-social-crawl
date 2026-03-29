# frontend/src/pages/chat-create-image/ — AI Image Creation Page

## Role
UI for AI-powered image generation and redesign workflow.
Split from the original single `ChatCreateImagePage.jsx` (64KB) into focused sub-components.

## Target Structure

```
frontend/src/pages/chat-create-image/
├── index.jsx              # Main ChatCreateImagePage — layout + orchestration
├── PromptPanel.jsx        # Text prompt input, model selector, generate button
├── ImageGallery.jsx       # Grid of generated images with download/select actions
├── AttributeTable.jsx     # Attribute extraction table (from uploaded images)
├── IdeaPanel.jsx          # Redesign idea generation + concept suggestions
├── PromptBuilder.jsx      # Build final generation prompts from attribute table
├── ChatHistory.jsx        # Chat session list sidebar
└── claude.md              # This file
```

## Component Responsibilities

### `index.jsx`
- Top-level layout: left sidebar (history) + main content area
- Owns view mode: "generate" | "analyze" | "redesign"
- Calls `useChatAI()` hook for session management

### `PromptPanel.jsx`
- Textarea for prompt input
- Model selector dropdown (Imagen model options)
- Num images selector (1–4)
- Generate button → `POST /api/generate-image`
- Shows saved prompt history for quick reuse

### `ImageGallery.jsx`
- Displays base64 image grid from generation results
- Download button per image
- Select image(s) for further analysis in `AttributeTable`

### `AttributeTable.jsx`
- Upload one or more images for analysis
- Calls `POST /api/generate-image/attributes` → returns attribute table
- Editable table: user can modify any extracted attribute value
- "Suggest" button per attribute → `POST /api/generate-image/suggest-attribute`
- "Concepts" button → `POST /api/generate-image/suggest-concepts`

### `IdeaPanel.jsx`
- Shows redesign ideas generated from attribute table
- Calls `POST /api/generate-image/idea`
- Displays concepts as selectable cards

### `PromptBuilder.jsx`
- Converts finalized attribute table → image generation prompts
- Calls `POST /api/generate-image/build-prompt`
- Shows generated prompts; user can send them to `PromptPanel` for generation

### `ChatHistory.jsx`
- Sidebar list of saved chat sessions (title, created_at, message_count)
- Load session → restores state into main view
- Delete session → `DELETE /api/chat-ai/history/{id}`
- Uses `useChatAI()` hook

## Tasks Done
- [ ] Split `ChatCreateImagePage.jsx` into sub-components listed above
- [ ] Create `useChatAI()` hook in `frontend/src/hooks/`

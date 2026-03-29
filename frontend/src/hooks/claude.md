# frontend/src/hooks/ — Custom React Hooks

## Role
Extracts stateful logic and API communication out of page components into
reusable, testable hooks. Each hook owns one domain of state.
Page components become thin render layers that consume hook return values.

## Target Structure

```
frontend/src/hooks/
├── useCrawlSearch.js      # Crawl page: keyword search, history, source selection
├── useHuntData.js         # Hunt page: keyword table, product table, classify, filters
├── useProject.js          # Projects: CRUD, queue, phase transitions
├── useEtsyListing.js      # Etsy listing: REQ1–REQ5 pipeline state
├── useChatAI.js           # Chat AI: session management, message history
└── claude.md              # This file
```

## Hook Contracts

### `useCrawlSearch()`
```js
return {
  results, loading, error,           // Current search state
  history, historyLoading,           // History list
  search(keyword, sources, options), // Trigger multi-source crawl
  loadHistory(id),                   // Load a past crawl result
  deleteHistory(id),                 // Remove from history
}
```

### `useHuntData()`
```js
return {
  huntDetail, classifiedRows,        // Current CSV data + NER columns
  huntHistory, productHistory,       // File lists
  classifyingFile,                   // Classify loading state
  loadFile(filename),                // Load a keyword CSV
  classify(filename),                // Run Gemini NER classify
  deleteFile(filename),              // Remove keyword CSV
  searchProducts(filters),           // POST to /api/etsy_hunt/products
}
```

### `useProject()`
```js
return {
  projects, currentProject,          // Project list + selected project
  queue,                             // Task queue items
  createProject(name),               // POST /api/projects
  updateProject(project),            // PUT /api/projects/{id}
  deleteProject(id),                 // DELETE /api/projects/{id}
  addToQueue(task),                  // POST /api/projects/queue
  removeFromQueue(itemId),           // DELETE /api/projects/queue/{id}
}
```

### `useEtsyListing()`
```js
return {
  listingHistory,                    // Full history object (req1–req5)
  listingName, setListingName,       // Active listing session key
  runReq1(url), runReq2(title),      // REQ pipeline triggers
  runReq3(), runReq4(fields),
  runReq5(images),
  extractFromFile(file),             // Auto-fill REQ4 from .docx/.pdf
  loading,                           // Per-REQ loading flags
}
```

### `useChatAI()`
```js
return {
  sessions,                          // List of saved sessions
  currentSession,                    // Active session object
  loadSession(id),                   // GET /api/chat-ai/history/{id}
  saveSession(session),              // POST /api/chat-ai/history
  deleteSession(id),                 // DELETE /api/chat-ai/history/{id}
}
```

## Why This Matters
Current page files are 50–85KB because they mix:
1. `useState` / `useEffect` declarations
2. API fetch calls with error handling
3. Business logic (sorting, filtering, data transformation)
4. JSX rendering

Hooks extract items 1–3 so page files become focused render-only components.

## Tasks Done
- [ ] Create `hooks/` directory
- [ ] Extract `useCrawlSearch` from `CrawlPage.jsx`
- [ ] Extract `useHuntData` from `HuntPage.jsx`
- [ ] Extract `useProject` from `projects/index.jsx` and `App.jsx`
- [ ] Extract `useEtsyListing` from `EtsyListingPage.jsx`
- [ ] Extract `useChatAI` from `ChatCreateImagePage.jsx`

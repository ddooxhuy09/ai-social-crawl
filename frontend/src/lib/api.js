import { API_BASE } from "../constants";

/**
 * Thin fetch wrapper that:
 *  - Prepends API_BASE to the path.
 *  - Relies on the global window.fetch patch in App.jsx for Bearer-token injection.
 *  - Parses the JSON response automatically.
 *  - Throws an Error with the server's `detail` message (or a fallback) when
 *    the response status is not OK.
 *
 * @param {string} path    - API path, e.g. "/api/projects"
 * @param {object} options - fetch options (method, headers, body, …)
 * @returns {Promise<any>} Parsed JSON body of a successful response.
 */
export async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || `Request failed with status ${response.status}`);
  }
  return data;
}

# Chatbot settings without generic fallback messages

Keyword Reply and AI Assistant mode controls are restored. The settings screen manages keyword rule creation, editing, deletion and activation alongside AI configuration. Saved Replies remain a separate Inbox interface and provide backend AI knowledge only.

Both automatic handlers check active tenant-scoped keyword rules before AI. The chatbot test endpoint, overview test and deterministic playground use the same keyword-first behavior. Matching rules do not consume AI quota. Unmatched messages may use paid, grounded AI; if AI is unavailable, returns no answer or requests human review, the existing staff handover flow replaces generic fallback messages.

The Fallback Message UI and writes to fallback fields remain removed. Handoff acknowledgements and the staff queue remain available. Historical fallback fields and keyword records are preserved; no SQL migration or data deletion is required.

Validation: node --test scripts/test-ai-only-routing.cjs scripts/test-inbox-reply-isolation.cjs scripts/test-shop-persona.cjs scripts/test-ai-paid-runtime.cjs

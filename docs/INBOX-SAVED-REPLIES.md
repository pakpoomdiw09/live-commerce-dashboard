# Saved Replies and keyword automation

Saved Replies in the Inbox are manual staff templates. Their only source is `inbox_quick_replies`, accessed through the tenant-authorized `/api/inbox/quick-replies` API. The modal owns its list, search, form and selection state. Selecting a template inserts its text into the composer; staff still send the message themselves. Creating, editing or deleting a template does not change bot settings or rules.

`/chatbot/conversations` manages `chat_rules` and `bot_settings`. The webhook calls `answerChat`; the legacy and orchestrated automation paths load keyword rules on the server and use AI/store knowledge through their existing policies. Keyword matching remains independent of manual templates. `chat_rules.quick_replies` represents Messenger buttons attached to an automated reply, not Inbox Saved Replies.

The previous `/api/inbox/state` implementation queried active keyword rule text and exposed it as `quickReplies`; the modal merged that into its manual list. That bridge has been removed from the endpoint, InboxState type and component props. Inbox state now supplies conversation/team/permission metadata only. The modal remounts when switching tenants so manual template state cannot carry over to another shop.

No database migration or historical deletion is required. Existing rules remain bot rules and existing templates remain manual templates. A numeric string such as `200` is valid message content if it was actually saved; this change removes rule-derived content from the manual list without rewriting messages or guessing which text is unwanted.

Validation: `node --test scripts/test-inbox-reply-isolation.cjs scripts/test-inbox-quick-replies.cjs` verifies endpoint separation, tenant scope, CRUD guards and literal content handling.

## Backend AI knowledge

`prepareAgentGeneration` reads the current tenant's `inbox_quick_replies` on every generation alongside shop settings and products, before reserving AI quota. All saved templates within the storage limit of 100 are added as selectable `saved-reply:<id>` knowledge records; shortcut is the title and body is the fact text. No exact keyword match is required. New, edited and deleted templates are reflected on the next generation without a cache or a UI dependency.

The model selects relevant IDs; `finishAgentGeneration` renders the corresponding database text and records the source IDs in usage. Shop account numbers remain exact, including leading zeroes. Saved content is reference data, not system instructions. Payment instructions can answer a request for the shop account, but do not prove any payment occurred. Existing output checks still reject invented IDs, protected payment/order claims and prompt-injection content. Conflicting facts are instructed to hand off.

Failed reads, a dataset exceeding the storage limit, or templates containing API credentials stop preparation before quota reservation. No template contents are logged. AI feature access, quota, service-window and automation policy checks remain in place; this feature does not enable AI for an ineligible tenant. UI/API management and keyword rule state remain separate.

Run `node --test scripts/test-shop-persona.cjs scripts/test-ai-paid-runtime.cjs` to verify tenant isolation, exact bank details, edit/delete freshness, credential/read failures, grounded output and paid usage behavior. These tests mock the provider; live semantic selection still requires a configured Gemini model and a real customer question.

# Image context for the chat AI

The current provider is Gemini. Signed Facebook image attachments are passed
through Incoming.imageUrls to AiContext in both legacy and orchestrated AI paths.
Image-only messages receive a product-question prompt. Keyword mode remains
independent; human takeover, tenant settings, paid quota and message-window checks
still apply. The explicitly enabled dedicated Vision Center takes precedence to
avoid duplicate replies. A saved, disabled Vision Master Switch suppresses image
fallbacks; otherwise shops without Vision settings retain AI-mode image chats, which bypass legacy slip-only
processing; images cannot confirm payment.

The existing managed context builder loads this tenant's active product names,
prices, stock, descriptions, shop knowledge and saved replies. The model selects
grounded product codes rather than inventing product facts. Uncertain visual
matches must clarify or hand off. No additional unbounded product query is added.

Images are downloaded using the existing Meta-CDN-only downloader (HTTPS, no
redirects, valid JPG/PNG/WebP signatures, 5 MB per image, 10-second download timeout).
At most three unique images are included. Gemini receives inlineData parts after
text history sanitization, so sanitization does not erase the image content.
llm-vision.ts also exports visionMessageContent() producing text/image_url parts
with data URLs for an OpenAI-compatible provider. This is an adapter, not a new
OpenAI runtime/provider switch; no OPENAI_API_KEY or SDK is required.

Expired/invalid links and image-provider failures return VISION_FALLBACK requesting
a new image or product details, release failed managed usage and do not retry the
provider automatically. Policy/permission/quota failures retain existing handling.
Normal delivery checks and idempotent dispatch still apply to the fallback text.
The persisted customer message is not rolled back when image processing fails.

## Product photo matching

The catalog now includes image_url and commerce_images for every active,
non-archived product, paged in batches of 100 (the existing 10,000-record and
500,000-character context safeguards still apply). The model receives all catalog
metadata, including image URLs, and up to 12 primary product photos as labeled
384px WebP references, each at most 256 KB. Downloads run three at a time with
three-second timeouts and bounded image decoding; broken references are skipped.
Reference fetching only permits the current tenant's Shop V2 public storage
paths on the configured Supabase origin. External/legacy URLs remain metadata,
not fetched image references. Customer images remain limited to three.

The model is explicitly told that a URL in text is not visual evidence. It selects
existing product codes from available evidence, or CLARIFY when there is no clear
match. Image CLARIFY renders: สนใจสินค้าตัวไหน สอบถามเพิ่มเติมได้เลยนะคะ
Matching image replies include stored product descriptions as well as name, code,
price and stock. HANDOFF for sensitive/policy issues remains unchanged. Product
prices/descriptions are rendered from database records, never model-written facts.
Actual provider failures still use the separate image-retry fallback.

## Diagnosing pre-provider fallback

Follow `[AI VISION] webhook route` -> `input` -> `[VISION DOWNLOAD] start/response`
-> `customer images ready` -> `catalog ready` -> `Gemini request/response`.
Preparation failures name the customer_download/catalog_references/build_contents
stage and expose a bounded sanitized error message/cause code. Provider failures
log the resolved model, HTTP status and error separately. No signed URL query
parameters or image base64 are included in these new diagnostics.

CDN downloads may have missing or generic binary MIME headers. The downloader now
infers JPEG/PNG/WebP from magic bytes for those responses, and normalizes image/jpg
to image/jpeg. HTML/unsupported content and mismatched explicit MIME still fail.
Upload validation remains strict. Redirects and arbitrary hosts remain blocked.

No schema migration is required. Tests use mock provider responses and downloads;
no real customer messages or Gemini calls were sent during verification.

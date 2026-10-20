# Product media in automatic chat replies

Gemini's structured record-selection JSON now requests has_product, product_id
and image_url alongside its decision and source codes. The backend still renders
text from verified shop records. Product IDs and primary image URLs are resolved
from the tenant-scoped catalog, ignoring model-provided IDs/URLs. Catalog reads
include id, image_url and commerce_images; general answers have no product media.

Both legacy and orchestrated AI reply paths receive the verified product metadata.
Text-only/draft callers retain their existing aiReply string API. With a valid
HTTPS image URL, the automated Messenger path sends text first via deliverOnce,
then an image attachment via deliverRichOnce using a separate `reply:<id>:image`
key. Both sends retain existing ownership, message-window and credit checks.
Messenger may charge separate message credits for text and image.

Empty, null, malformed, non-HTTPS and credential-bearing URLs are rejected locally.
The server does not fetch arbitrary product URLs to test availability. If Messenger
cannot fetch the image or the media send fails, the text is already delivered and
the process continues. The media row retains failed/unknown delivery state and a
warning is logged. Unknown image outcomes are not resent automatically; a repeated
text claim also skips media to prevent duplicate sends. No schema changes or LINE
transport were introduced (the current project uses Facebook Messenger).

The conversations Playground's `/api/chatbot/test-reply` now returns image_url,
has_product and product_id from the same aiReply metadata callback used by real
delivery. imageUrl is retained as a compatibility alias, including keyword images.
The overview trial endpoint also exposes the verified product metadata. The chat
UI renders product images below text and removes only the image preview on load
failure. Preview URLs must be HTTPS without embedded credentials.

Playground generation shares the managed context builder and product validation;
it does not dispatch Messenger messages, claim live customer ownership or simulate
every live conversation gate. Different settings/history or model sampling can
change answers, so this is not a guarantee of identical responses for every run.

Tests cover canonical DB metadata versus forged model fields, unsafe/missing URLs,
text+attachment payloads, media rejection/timeout, duplicate suppression, and both
AI routing branches. No real Messenger messages were sent during verification.

// Financial fixtures must follow the public confirmation flow before reading orders.
const { randomUUID } = require('node:crypto')
const load = require('./load-typescript.cjs')
const { parseAuctionComment } = load('lib/integrations/facebook/auction-comment-parser.ts')
module.exports = async function confirmWinner(db, auctionId, tenant) {
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  const a = await one('select * from auctions where id=$1', [auctionId])
  const payload = await one("insert into facebook_webhook_payloads(payload_sha256,raw_payload) values($1,'{}') returning id", [randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')])
  const message = a.session_automation?.keywords?.[0] || '1'
  const parsed = parseAuctionComment(message, false, { keywords: [message] })
  if (parsed.type !== 'CONFIRM_BID') throw Error('Fixture confirmation did not parse')
  const e = await one(`insert into facebook_webhook_events(payload_id,page_id,event_key,ordering_key,kind,payload,status)
    values($1,$2,$3,$4,'change',$5,'completed') returning id`, [payload.id, a.page_id, randomUUID(), 'comments:' + a.page_id, {
      field: 'feed', value: { item: 'comment', verb: 'add', post_id: a.live_post_id, comment_id: randomUUID(),
        from: { id: a.leading_bidder_id }, message, created_time: new Date().toISOString() },
    }])
  return (await one('select process_live_auction_comment($1,$2,$3,$4) result', [a.id, tenant, e.id, parsed.type])).result
}

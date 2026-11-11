// Financial fixtures must follow the public confirmation flow before reading orders.
const { randomUUID } = require('node:crypto')
const load = require('./load-typescript.cjs')
const { parseAuctionComment } = load('lib/integrations/facebook/auction-comment-parser.ts')
module.exports = async function confirmWinner(db, auctionId, tenant) {
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  const event = async (a, sender, message) => {
    const payload = await one(
      "insert into facebook_webhook_payloads(payload_sha256,raw_payload) values($1,'{}') returning id",
      [randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')],
    )
    return one(
      `insert into facebook_webhook_events(payload_id,page_id,event_key,ordering_key,kind,payload,status)
       values($1,$2,$3,$4,'change',$5,'completed') returning id`,
      [payload.id, a.page_id, randomUUID(), 'comments:' + a.page_id, {
        field: 'feed',
        value: {
          item: 'comment',
          verb: 'add',
          post_id: a.live_post_id,
          comment_id: randomUUID(),
          from: { id: sender, name: sender === a.page_id ? 'Host' : a.leading_bidder_name },
          message,
          created_time: new Date().toISOString(),
        },
      }],
    )
  }

  let a = await one('select * from auctions where id=$1', [auctionId])
  const automation = {
    ...(a.session_automation || {}),
    winnerFlow: 'on_demand',
    keywords: a.session_automation?.keywords?.length ? a.session_automation.keywords : ['1'],
    closeKeywords: a.session_automation?.closeKeywords?.length
      ? a.session_automation.closeKeywords
      : ['ปิด'],
    closeEnabled: true,
  }
  await db.query('update auctions set session_automation=$2::jsonb where id=$1', [
    auctionId,
    JSON.stringify(automation),
  ])

  // Seed an accepted bid if this fixture started from dashboard leader fields only.
  const bidEvent = await event(a, a.leading_bidder_id, String(a.current_price))
  await db.query(
    `insert into auction_bids(auction_id,event_id,comment_id,bidder_id,bidder_name,comment_text,bid_amount,is_opening,status,result)
     values($1,$2,$3,$4,$5,$6,$7,false,'accepted','{"status":"accepted"}'::jsonb)
     on conflict(auction_id,comment_id) do nothing`,
    [auctionId, bidEvent.id, 'fixture-bid-' + randomUUID(), a.leading_bidder_id, a.leading_bidder_name,
      String(a.current_price), a.current_price],
  )

  if (a.status === 'active') {
    const closeEvent = await event(a, a.page_id, automation.closeKeywords[0])
    await one('select process_live_auction_comment($1,$2,$3,$4,null,$5) result', [
      auctionId,
      tenant,
      closeEvent.id,
      'HOST_CONTROL',
      'close',
    ])
  } else {
    await db.query(
      "update auctions set status='closed',closed_at=coalesce(closed_at,clock_timestamp()),winner_locked_at=coalesce(winner_locked_at,clock_timestamp()) where id=$1",
      [auctionId],
    )
  }
  a = await one('select * from auctions where id=$1', [auctionId])
  await one('select designate_live_auction_winner($1,$2,$3) result', [
    auctionId,
    tenant,
    a.leading_bidder_id,
  ])

  const scope = await one(
    `select t.page_id tenant_page,a.page_id auction_page,a.tenant_id auction_tenant,a.id auction_id
     from tenants t cross join auctions a where t.id=$1 and a.id=$2`,
    [tenant, auctionId],
  )
  if (
    !scope || scope.tenant_page !== scope.auction_page || scope.auction_tenant !== tenant
  ) throw Error('Fixture auction tenant/page scope mismatch: ' + JSON.stringify(scope))

  const message = automation.keywords[0]
  const parsed = parseAuctionComment(
    message,
    false,
    { keywords: automation.keywords, closeEnabled: true, heartCloses: false },
    true,
  )
  if (parsed.type !== 'CONFIRM_BID') throw Error('Fixture confirmation did not parse')
  const e = await event(a, a.leading_bidder_id, message)
  return (await one('select process_live_auction_comment($1,$2,$3,$4) result', [a.id, tenant, e.id, parsed.type])).result
}

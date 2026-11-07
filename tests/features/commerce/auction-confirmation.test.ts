import { createRequire } from 'node:module'

// Exercise the real PostgreSQL workflow in the main suite as well as test:auctions.
createRequire(import.meta.url)('../../../scripts/test-auction-on-demand.cjs')

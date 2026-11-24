// Crowd-launch sniper for the pump.fun bonding-curve replay.
//
// Idea, from measuring the dev window (24h, 1222 coins): buying every fresh
// launch loses money, and buying after a coin has already proven itself loses
// much more (by the time real SOL is high the price has peaked and the dump
// is coming). What works is narrow: buy only launches that are crowded in
// their first three slots (six or more distinct non-creator buyers piling in
// at once), take a small fast profit (+8%), and otherwise let a tight
// trailing stop do the selling (arms at +1%, exits on a 6% fall from the
// best value). No hard stop loss: on this data a stop only whipsaws exits
// while the trail already caps the downside. One buy per coin, no adds, no
// partials, no order splitting (a split piece pays its own tx fee).
//
// The entry filter is what makes it: crowded launches spike first and dump
// later, so the bot is usually out (TP or trail) before the dump. Uncrowded
// launches mostly sit flat and bleed fees, so they are skipped entirely.
// 165 coins pass the filter on the dev window, far above the 20-coin bar.
//
// Deterministic by construction: no clock, no randomness, no I/O. All
// decisions are pure functions of the batches the harness sends, iterated
// over insertion-ordered maps, so the two graded executions agree exactly.

import type { Batch, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

const BPS = 10_000n;
// Curve fees on a sale: protocol 95 bps + creator 30 bps.
const CURVE_FEE_BPS = 125n;

const TUNE = {
  /** Buy at most this much SOL per coin (the 1%-of-real-reserve cap binds first). */
  stakeLamports: 300_000_000n,
  /** Smallest buy worth paying a tx fee for. */
  minBuyLamports: 5_000_000n,
  /** Youngest/oldest age (slots since CreateEvent) a first buy may be decided at. */
  minAge: 0,
  maxAge: 3,
  /** Real SOL reserve window at decision time. */
  minRealSolLamports: 1_000_000_000n,
  maxRealSolLamports: 30_000_000_000n,
  /** Creator's own buys in the create slot: at most this (a dev loading up is a dump setup). */
  maxDevBuyLamports: 2_500_000_000n,
  /** Distinct non-creator buyers before entry: at least this many (the crowd test). */
  minBuyers: 6,
  /** Sell slippage on exits: wide open, the trail decides the price, not the slip. */
  sellSlippageBps: 10_000,
  /** Buy slippage: wide open too; the entry window is three slots, there is no time to be picky. */
  buySlippageBps: 10_000,
  /** Exit when the position is worth this much over its basis (bps). */
  takeProfitBps: 800n,
  /** The trailing stop arms once value reaches basis * (1 + trailArmBps). */
  trailArmBps: 100n,
  /** ...and exits on a fall of this much (bps) from the best value seen. */
  trailBps: 600n,
  /** Exit after holding this many slots regardless. */
  maxHoldSlots: 600,
} as const;

/** What selling `tokens` against reserves (vq, vt) would pay after curve fees. */
function saleProceeds(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const gross = (tokens * vq) / (vt + tokens);
  return gross - (gross * CURVE_FEE_BPS + BPS - 1n) / BPS;
}

/** A launch watched from its CreateEvent: the opening tape in miniature. */
interface Launch {
  mint: Pubkey;
  createdSlot: number;
  creator: Pubkey;
  devBuy: bigint;
  devSold: boolean;
  buyers: Set<Pubkey>;
  attempted: boolean;
  done: boolean;
}

/** A position the bot opened, with the bookkeeping its exits need. */
interface OpenTrade {
  openedSlot: number;
  /** Tx fees paid on this position's fills so far. */
  txPaid: bigint;
  bestValue: bigint;
  devSoldAtOpen: boolean;
}

export function createCrowdBot() {
  const launches = new Map<Pubkey, Launch>();
  const open = new Map<Pubkey, OpenTrade>();
  /** Mints with a sell sent and not yet reported back. */
  const selling = new Set<Pubkey>();

  const launchOf = (mint: Pubkey): Launch => {
    let launch = launches.get(mint);
    if (launch === undefined) {
      launch = {
        mint,
        createdSlot: -1,
        creator: '',
        devBuy: 0n,
        devSold: false,
        buyers: new Set(),
        attempted: false,
        done: false,
      };
      launches.set(mint, launch);
    }
    return launch;
  };

  /** Fold this batch's events into the launch tapes. */
  function readTape(batch: Batch): void {
    for (const event of batch.events) {
      if (event.event === 'CreateEvent') {
        const launch = launchOf(event.mint);
        launch.createdSlot = event.slot;
        launch.creator = event.creator;
      } else if (event.event === 'TradeEvent') {
        const launch = launches.get(event.mint);
        if (launch === undefined) continue;
        const sol = BigInt(event.sol_amount);
        const isDev = event.user === launch.creator;
        if (event.is_buy) {
          if (isDev && event.slot === launch.createdSlot) launch.devBuy += sol;
          else if (!isDev) launch.buyers.add(event.user);
        } else if (isDev) {
          launch.devSold = true;
        }
      } else {
        const launch = launches.get(event.mint);
        if (launch !== undefined) launch.done = true;
      }
    }
  }

  function hasPending(state: BotState, mint: Pubkey, side: 'buy' | 'sell'): boolean {
    for (const pending of state.pending.values()) {
      if (pending.order.mint === mint && pending.order.side === side) return true;
    }
    return false;
  }

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      readTape(batch);
      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const txFee = state.txFeeLamports();

      // Settle this batch's fills first: open trades, track fees, drop closes.
      for (const fill of batch.fills) {
        if (fill.client_id.startsWith('_')) {
          open.delete(fill.mint);
          selling.delete(fill.mint);
          const launch = launches.get(fill.mint);
          if (launch !== undefined) launch.done = true;
          continue;
        }
        if (fill.status === 'filled') {
          const trade = open.get(fill.mint);
          if (fill.side === 'buy' && trade === undefined) {
            const launch = launches.get(fill.mint);
            open.set(fill.mint, {
              openedSlot: fill.slot,
              txPaid: BigInt(fill.tx_fee_lamports),
              bestValue: 0n,
              devSoldAtOpen: launch?.devSold ?? false,
            });
          } else if (trade !== undefined) {
            trade.txPaid += BigInt(fill.tx_fee_lamports);
          }
        }
        if (fill.side === 'sell') selling.delete(fill.mint);
      }
      for (const mint of [...selling]) {
        if (!hasPending(state, mint, 'sell')) selling.delete(mint);
      }
      for (const mint of [...open.keys()]) {
        if (!state.positions.has(mint) && !selling.has(mint) && !hasPending(state, mint, 'buy')) {
          open.delete(mint);
        }
      }

      // Exits first: a position leaves on take-profit, the trailing stop,
      // the hold limit, or the creator selling after we bought in.
      for (const [mint, position] of state.positions) {
        if (orders.length >= cap) break;
        if (selling.has(mint)) continue;
        const launch = launches.get(mint);
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        let trade = open.get(mint);
        if (trade === undefined) {
          trade = { openedSlot: state.slot, txPaid: txFee, bestValue: 0n, devSoldAtOpen: launch?.devSold ?? false };
          open.set(mint, trade);
        }
        const mark = batch.marks.find((m) => m.mint === mint);
        const vq = mark ? BigInt(mark.virtual_quote_reserves) : curve.virtual_quote_reserves;
        const vt = mark ? BigInt(mark.virtual_token_reserves) : curve.virtual_token_reserves;
        const value = saleProceeds(position.token_amount, vq, vt) - txFee;
        const basis = position.cost_lamports + trade.txPaid;
        if (value > trade.bestValue) trade.bestValue = value;
        let leave = false;
        if (basis > 0n) {
          if (value * BPS >= basis * (BPS + TUNE.takeProfitBps)) leave = true;
          if (
            !leave &&
            trade.bestValue * BPS >= basis * (BPS + TUNE.trailArmBps) &&
            value * BPS <= trade.bestValue * (BPS - TUNE.trailBps)
          ) {
            leave = true;
          }
        }
        if (!leave && state.slot - trade.openedSlot >= TUNE.maxHoldSlots) leave = true;
        if (!leave && launch !== undefined && launch.devSold && !trade.devSoldAtOpen) leave = true;
        if (!leave) continue;
        orders.push({ side: 'sell', mint, token_amount: position.token_amount, max_slippage_bps: TUNE.sellSlippageBps });
        selling.add(mint);
        if (launch !== undefined) launch.done = true;
      }

      // Entries: crowded launches only, decided inside their first three slots.
      let free = state.freeCashLamports();
      let room = state.hello.caps.max_open_positions - state.committedPositionCount();
      for (const launch of launches.values()) {
        if (orders.length >= cap || room <= 0) break;
        if (launch.done || launch.attempted || launch.createdSlot < 0) continue;
        const age = state.slot - launch.createdSlot;
        if (age < TUNE.minAge) continue;
        if (age > TUNE.maxAge) {
          launch.done = true;
          continue;
        }
        const curve = state.curves.get(launch.mint);
        if (curve === undefined || curve.complete) continue;
        if (launch.devSold) {
          launch.done = true;
          continue;
        }
        if (launch.devBuy > TUNE.maxDevBuyLamports) continue;
        if (launch.buyers.size < TUNE.minBuyers) continue;
        const realSol = curve.real_quote_reserves;
        if (realSol < TUNE.minRealSolLamports || realSol > TUNE.maxRealSolLamports) continue;
        if (hasPending(state, launch.mint, 'buy') || state.positions.has(launch.mint)) continue;
        const sizeCap = state.maxBuyLamports(launch.mint);
        let amount = TUNE.stakeLamports < sizeCap ? TUNE.stakeLamports : sizeCap;
        if (amount > free - txFee) amount = free - txFee;
        if (amount < TUNE.minBuyLamports) continue;
        orders.push({ side: 'buy', mint: launch.mint, quote_lamports: amount, max_slippage_bps: TUNE.buySlippageBps });
        launch.attempted = true;
        free -= amount + txFee;
        room -= 1;
      }
      return orders;
    },
  };
}

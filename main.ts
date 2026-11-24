// Pump.fun Replay Sprint — crowd-launch sniper.
//
// The bot trades 10 SOL of paper money on a 24h replay of pump.fun bonding
// curves. It buys only launches that are crowded in their first three slots
// (six or more distinct non-creator buyers), then exits on a +8% take-profit,
// a tight trailing stop (arms at +1%, exits on a 6% fall from the best value),
// a 600-slot hold limit, or the creator selling. One buy per coin, no adds.
//
// Run by the grader as `node /bot/main.ts`. The strategy lives in crowd.ts;
// the protocol shim is vendored in vendor/makefun-bot.ts.

import { runBot } from './vendor/makefun-bot.ts';
import { createCrowdBot } from './crowd.ts';

await runBot(createCrowdBot());

# pumpfun-replay-bot-entry

[![make.fun · u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/fadlisick/pumpfun-replay-bot-entry/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/fadlisick/pumpfun-replay-bot-entry/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

A paper trading bot for the Pump.fun Replay Sprint: it trades 10 SOL of paper money on a 24-hour replay of pump.fun bonding-curve activity. It buys only launches that are crowded in their first three slots (six or more distinct non-creator buyers), then exits on a +8% take-profit, a tight trailing stop (arms at +1%, exits on a 6% fall from the best value), a 600-slot hold limit, or the creator selling. One buy per coin, no adds, no leverage, no shorts. Fully deterministic: no clock, no randomness, no network.

## Run it

The grader runs it as `node /bot/main.ts` (Node 22). The strategy lives in `crowd.ts`; the agent-fun/replay/v2 protocol shim is vendored in `vendor/makefun-bot.ts`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=etjmfhb5&utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122) · AI agents build software for cash rewards</sub>

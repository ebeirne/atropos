# Setting up the trading agent

Atropos's agent reads the news about the companies you own and the ones you're watching. It checks each story
against independent outlets, SEC filings and prediction markets. When the evidence is strong, it proposes a
trade and waits for you to approve it.

It never trades on its own. Fidelity has no trading API, so an approved trade becomes a line on a checklist
("Buy $1,200.00 of NVDA at Fidelity: market order") that you place in Fidelity yourself. Your Fidelity account is
connected read-only, through SnapTrade, so the agent can see your holdings and can't touch them.

This takes about 10 minutes on a Windows computer.

## What you need

| | where | cost |
|---|---|---|
| A Claude API key | [console.anthropic.com](https://console.anthropic.com) → API keys | pay as you go; see "Cost" below |
| SnapTrade personal keys (a Client ID starting `PERS-` and a Consumer Key) | sign up at [dashboard.snaptrade.com](https://dashboard.snaptrade.com), then create personal keys | free for personal use |
| Your Fidelity login | you'll use it once, on Fidelity's own page, to allow read-only access | |
| A name and email | the SEC asks for one when software reads its filings; it's sent only to sec.gov | |

## 1. Install it

Open **PowerShell** (Start menu → type "PowerShell") and paste this line:

```powershell
irm https://raw.githubusercontent.com/ebeirne/atropos/main/scripts/setup-agent.ps1 | iex
```

It does the rest:

1. **Installs what's missing:** Git, Node.js, and uv (which brings its own Python). Windows' `winget` may ask you to
   accept their terms.
2. **Downloads Atropos** into `C:\atropos`.
3. **Asks for your keys.** Paste each one and press Enter; the keys stay hidden as you type. They're saved in
   `C:\atropos\.env` on your computer and nowhere else.
4. **Starts the agent now and at every login,** in two minimized windows.
5. **Opens the agent page** at http://127.0.0.1:4411/agent.html.

## 2. Link Fidelity

On the agent page, under **Your account**, click **Link Fidelity**. Sign in on Fidelity's own page and allow
read-only access; you'll land back on the agent page, which will show your holdings.

That's it.

## Using it

The agent checks the news every hour. The page has three parts:

- **Waiting for you:** trades it wants to make. Each shows the thesis, the risks, what would prove it wrong,
  who reported the story, and any prediction markets it checked. Click **Approve** or **Reject**.
- **Orders:** approved trades, as a checklist. Place each one in Fidelity, then click **Placed** (or **Won't
  place**). That tells the agent's limits what you actually did.
- **Stories:** everything it's following, and why each did or didn't become a trade.

**Stop all trading** at the top is the kill switch. While it's on, the agent keeps reading but proposes nothing.

It can go days without proposing anything. A story has to clear all of these checks first:

1. It's recent.
2. A primary source backs it: an SEC filing or the company's own press release.
3. At least two independent major outlets report it. Twelve sites copying one Reuters story count as one.
4. The claims agree on what it means for the stock.
5. No well-traded prediction market contradicts it.

After that, Claude has to see a real long-term case, and most news doesn't make one.

## The limits

Every order, approved or not, goes through a guard you can't talk past. Its limits are in
`C:\atropos\services\intel\policy.toml`:

- no single holding above 5% of your account after a buy;
- at least 10% kept in cash;
- at most $2,500 per order, 3 trades a day, and 15% of the account traded in a week;
- no short selling: a sell can't be larger than what you hold.

Edit that file to change any of them. Changes apply on the next check, with no restart needed.

## What it watches

Everything you hold, plus the companies in `C:\atropos\services\intel\watchlist.toml`. Add companies you'd
consider buying there. Each needs a ticker and a name.

## Cost

Claude reads each new article and writes a thesis for stories that clear the checks. At the default (Claude
Opus 5.5, every hour), plan on a few dollars a day, and check your usage on console.anthropic.com after the
first day. To spend less, add `INTEL_MODEL=claude-sonnet-5-5` to `C:\atropos\.env` (about half the price), or
check less often: change `--every 60` in `C:\atropos\scripts\start-agent.cmd` to `--every 180`. After either
change, restart it: close its two windows, then run `C:\atropos\scripts\start-agent.cmd`.

## Updating, stopping, removing

- **Update:** run the same PowerShell line again. It keeps your keys.
- **Stop for now:** close the two minimized windows named "Atropos" and "Atropos agent".
- **Start again:** double-click `C:\atropos\scripts\start-agent.cmd`.
- **Stop starting at login:** press Win+R, type `shell:startup`, and delete "Atropos agent".
- **Remove:** do both of the above, then delete `C:\atropos`. You can also unlink Fidelity from SnapTrade's dashboard.

## What leaves your computer

- **Claude** sees the articles. For a stock you hold, it also sees that holding's value and its share of your
  account. It never sees your login or account numbers.
- **SnapTrade** connects to Fidelity read-only on your behalf.
- **The SEC** gets the name and email you entered.
- **Everything else stays local:** your keys, the evidence it collected, and your orders.

## If something's wrong

- **The page says "Not running here":** the agent isn't running. Run `C:\atropos\scripts\start-agent.cmd`.
- **"No Claude key":** the key is missing or wrong. Run the setup line again.
- **"SnapTrade isn't set up":** the SnapTrade keys are missing. Run the setup line again.
- **Logs:** `C:\atropos\services\intel\data\agent.log` for the agent and `C:\atropos\data\atropos.log` for Atropos.

This is software that helps you read the news. It isn't financial advice, and every trade is your decision.

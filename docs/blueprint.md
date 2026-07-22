# Crypto Watchlist Alerts Bot — Bot specification

**Archetype:** custom

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

A private Telegram bot for tracking cryptocurrency prices with customizable threshold/percentage alerts, on-demand price checks, daily summaries, and quiet hours. Owner view provides user analytics and top alert metrics.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- Individual crypto investors
- Hodlers
- Price trackers

## Success criteria

- Users can create and manage watchlists with valid crypto tickers
- Alerts trigger accurately based on configured rules and cooldowns
- Daily summaries deliver at user-selected local times
- Owner dashboard shows active user count and top 10 alerts

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Initialize bot and show onboarding menu
- **/price** (command, actor: user, command: /price) — Request current price(s) for watchlist
- **Add Coin** (button, actor: user, callback: watchlist:add) — Open ticker selection menu
- **Set Alert** (button, actor: user, callback: alert:create) — Configure price threshold or percentage alert
- **Owner Dashboard** (button, actor: owner, callback: owner:metrics) — Show admin metrics (requires owner authentication)

## Flows

### Onboarding
_Trigger:_ /start

1. Display welcome message with seeded ticker buttons
2. Request timezone selection
3. Confirm quiet hours window
4. Prompt for morning summary preference

_Data touched:_ User Profile

### Alert Creation
_Trigger:_ alert:create

1. Select coin from watchlist
2. Choose alert type (threshold/percentage)
3. Set direction and value
4. Confirm rule with preview message

_Data touched:_ Alert Rule, Watchlist Item

### Price Check
_Trigger:_ /price

1. Validate ticker parameter
2. Fetch current price data
3. Compare with stored last price
4. Display formatted price change metrics

_Data touched:_ Watchlist Item, User Profile

### Daily Summary
_Trigger:_ scheduled (user time)

1. Calculate 24h price changes for all watchlist items
2. Format top movers table
3. Include optional alert suggestions
4. Send as single message during non-quiet hours

_Data touched:_ Watchlist Item, User Profile

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **User Profile** _(retention: persistent)_ — User preferences and settings
  - fields: chat_id, timezone, quiet_hours_start, quiet_hours_end, summary_time, summary_enabled, cooldown_minutes
- **Watchlist Item** _(retention: persistent)_ — Tracked cryptocurrency symbols
  - fields: user_id, ticker, display_name, last_price, last_updated
- **Alert Rule** _(retention: persistent)_ — Price alert configuration
  - fields: user_id, ticker, alert_type, direction, value, active, last_fired
- **Owner Metrics** _(retention: persistent)_ — Administrative statistics
  - fields: total_users, alert_triggers_30d, top_alerts

## Integrations

- **Telegram** (required) — Bot API messaging
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- View user count
- View top 10 alerts
- Export metrics CSV

## Notifications

- Price alert notifications
- Daily summary digest
- Aggregated quiet hours alerts
- Price fetch failure warnings

## Permissions & privacy

- All data stored privately per user
- No third-party data sharing
- Owner metrics anonymized
- User can delete account data

## Edge cases

- Invalid ticker symbols during add
- Price API failures during alert evaluation
- Overlapping alert cooldown periods
- Quiet hours spanning midnight

## Required tests

- End-to-end alert triggering with cooldown enforcement
- Timezone-aware daily summary delivery
- Quiet hours alert aggregation
- Price command with invalid tickers

## Assumptions

- Price data source is reliable and available
- Users understand crypto market volatility
- Owner has separate admin authentication

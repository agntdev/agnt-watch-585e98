import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { userStore, watchlistStore, now } from "../storage.js";

// CoinGecko free API for 24h price data.
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

interface CoinMarketData {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_percentage_24h: number;
  price_change_percentage_7d_in_currency?: number;
  high_24h: number;
  low_24h: number;
  market_cap_rank: number | null;
}

async function fetchMarketData(ids: string[]): Promise<CoinMarketData[]> {
  if (ids.length === 0) return [];

  const params = new URLSearchParams({
    ids: ids.join(","),
    vs_currencies: "usd",
    include_24hr_change: "true",
    include_7d_change: "true",
    include_24hr_vol: "true",
    include_market_cap: "true",
  });

  try {
    const res = await fetch(`${COINGECKO_BASE}/coins/markets?${params}`);
    if (!res.ok) return [];
    return (await res.json()) as CoinMarketData[];
  } catch {
    return [];
  }
}

function formatPrice(price: number): string {
  if (price >= 1) {
    return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${price.toFixed(6)}`;
}

function formatChange(change: number | null | undefined): string {
  if (change === null || change === undefined) return "—";
  const sign = change >= 0 ? "+" : "";
  return `${sign}${change.toFixed(1)}%`;
}

// Check if current time is within quiet hours.
function isInQuietHours(quietStart: string, quietEnd: string, timezone: string): boolean {
  const nowDate = now();
  // Convert to user's timezone.
  const userTime = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(nowDate);

  const [currentHour, currentMin] = userTime.split(":").map(Number);
  const currentMinutes = currentHour * 60 + currentMin;

  const [startHour, startMin] = quietStart.split(":").map(Number);
  const startMinutes = startHour * 60 + startMin;

  const [endHour, endMin] = quietEnd.split(":").map(Number);
  const endMinutes = endHour * 60 + endMin;

  // Handle quiet hours spanning midnight.
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

const composer = new Composer<Ctx>();

// Daily summary callback.
composer.callbackQuery("daily:summary", async (ctx) => {
  await ctx.answerCallbackQuery();
  await sendDailySummary(ctx);
});

// Send daily summary for a user.
async function sendDailySummary(ctx: Ctx): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const items = await watchlistStore.getByUser(userId);
  if (items.length === 0) {
    await ctx.editMessageText(
      "📊 Your watchlist is empty.\n\nTap ➕ Add Coin to start tracking.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("➕ Add Coin", "watchlist:add")],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }

  const profile = await userStore.get(userId);
  // Check quiet hours if profile exists.
  if (profile && isInQuietHours(profile.quietHoursStart, profile.quietHoursEnd, profile.timezone)) {
    await ctx.editMessageText(
      "😴 It's quiet hours — summaries are paused.\n\nAlerts will resume when quiet hours end.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }

  const coingeckoIds = items.map((i) => i.coingeckoId);
  const prices = await fetchMarketData(coingeckoIds);

  if (prices.length === 0) {
    await ctx.editMessageText(
      "⚠️ Couldn't fetch price data right now. Try again later.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("🔄 Retry", "daily:summary")],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }

  // Sort by 24h change (biggest movers first).
  const sorted = [...prices].sort(
    (a, b) => Math.abs(b.price_change_percentage_24h ?? 0) - Math.abs(a.price_change_percentage_24h ?? 0),
  );

  const lines = sorted.map((coin, i) => {
    const priceStr = formatPrice(coin.current_price);
    const changeStr = formatChange(coin.price_change_percentage_24h);
    const changeEmoji = (coin.price_change_percentage_24h ?? 0) >= 0 ? "🟢" : "🔴";
    return `${i + 1}. ${changeEmoji} <b>${coin.name}</b> (${coin.symbol.toUpperCase()})\n   ${priceStr} (${changeStr} 24h)`;
  });

  // Alert suggestions based on significant moves.
  const suggestions: string[] = [];
  for (const coin of sorted) {
    const absChange = Math.abs(coin.price_change_percentage_24h ?? 0);
    if (absChange > 5) {
      const direction = (coin.price_change_percentage_24h ?? 0) > 0 ? "above" : "below";
      const targetPrice =
        direction === "above"
          ? coin.current_price * 1.05
          : coin.current_price * 0.95;
      suggestions.push(
        `💡 Consider a ${direction} alert for ${coin.name} at ${formatPrice(targetPrice)}`,
      );
    }
  }

  const nowDate = now();
  const timeStr = nowDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

  let report = `📊 <b>Daily Summary</b> — ${timeStr}\n\n`;
  report += lines.join("\n\n");

  if (suggestions.length > 0) {
    report += `\n\n<b>💡 Alert Suggestions</b>\n${suggestions.slice(0, 3).join("\n")}`;
  }

  report += `\n\n⏰ Next summary at ${profile?.summaryTime ?? "08:00"} (${profile?.timezone ?? "UTC"})`;

  await ctx.editMessageText(report, {
    parse_mode: "HTML",
    reply_markup: inlineKeyboard([
      [inlineButton("🔄 Refresh", "daily:summary")],
      [inlineButton("🔔 Set Alert", "alert:create")],
      [inlineButton("⬅️ Back to menu", "menu:main")],
    ]),
  });
}

export default composer;

import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { watchlistStore, now } from "../storage.js";

// CoinGecko free API (no key required).
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

interface CoinPrice {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_percentage_24h: number;
  high_24h: number;
  low_24h: number;
  market_cap_rank: number | null;
}

async function fetchPrices(ids: string[]): Promise<CoinPrice[]> {
  if (ids.length === 0) return [];

  const params = new URLSearchParams({
    ids: ids.join(","),
    vs_currencies: "usd",
    include_24hr_change: "true",
    include_24hr_vol: "true",
    include_market_cap: "true",
  });

  try {
    const res = await fetch(`${COINGECKO_BASE}/coins/markets?${params}`);
    if (!res.ok) {
      throw new Error(`CoinGecko API error: ${res.status}`);
    }
    return (await res.json()) as CoinPrice[];
  } catch (err) {
    console.error("[price] CoinGecko fetch failed:", err);
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

const composer = new Composer<Ctx>();

// /price command — check all watchlist prices.
composer.command("price", async (ctx) => {
  await ctx.replyWithChatAction("typing");
  const userId = ctx.from?.id;
  if (!userId) return;

  const items = await watchlistStore.getByUser(userId);
  if (items.length === 0) {
    await ctx.reply(
      "📊 Your watchlist is empty.\n\nTap ➕ Add Coin to start tracking cryptocurrencies.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("➕ Add Coin", "watchlist:add")],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }

  const coingeckoIds = items.map((i) => i.coingeckoId);
  const prices = await fetchPrices(coingeckoIds);

  if (prices.length === 0) {
    await ctx.reply("⚠️ Couldn't fetch prices right now. Try again in a moment.", {
      reply_markup: inlineKeyboard([
        [inlineButton("🔄 Retry", "price:check")],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
    return;
  }

  const lines = items.map((item) => {
    const priceData = prices.find((p) => p.id === item.coingeckoId);
    if (!priceData) {
      return `• <b>${item.displayName}</b> (${item.ticker.toUpperCase()}) — price unavailable`;
    }

    const priceStr = formatPrice(priceData.current_price);
    const changeStr = formatChange(priceData.price_change_percentage_24h);

    return `• <b>${item.displayName}</b> (${item.ticker.toUpperCase()})\n  ${priceStr} (${changeStr} 24h)`;
  });

  const nowTs = now();
  const timeStr = nowTs.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

  await ctx.reply(
    `📊 <b>Price Check</b> — ${timeStr}\n\n${lines.join("\n\n")}`,
    {
      parse_mode: "HTML",
      reply_markup: inlineKeyboard([
        [inlineButton("🔄 Refresh", "price:check")],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );

  // Update last prices in watchlist.
  for (const priceData of prices) {
    const item = items.find((i) => i.coingeckoId === priceData.id);
    if (item) {
      await watchlistStore.updateLastPrice(userId, item.ticker, priceData.current_price);
    }
  }
});

// Price check callback.
composer.callbackQuery("price:check", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.replyWithChatAction("typing");
  const userId = ctx.from?.id;
  if (!userId) return;

  const items = await watchlistStore.getByUser(userId);
  if (items.length === 0) {
    await ctx.editMessageText(
      "📊 Your watchlist is empty.\n\nTap ➕ Add Coin to start tracking cryptocurrencies.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("➕ Add Coin", "watchlist:add")],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }

  const coingeckoIds = items.map((i) => i.coingeckoId);
  const prices = await fetchPrices(coingeckoIds);

  if (prices.length === 0) {
    await ctx.editMessageText("⚠️ Couldn't fetch prices right now. Try again in a moment.", {
      reply_markup: inlineKeyboard([
        [inlineButton("🔄 Retry", "price:check")],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
    return;
  }

  const lines = items.map((item) => {
    const priceData = prices.find((p) => p.id === item.coingeckoId);
    if (!priceData) {
      return `• <b>${item.displayName}</b> (${item.ticker.toUpperCase()}) — price unavailable`;
    }

    const priceStr = formatPrice(priceData.current_price);
    const changeStr = formatChange(priceData.price_change_percentage_24h);

    return `• <b>${item.displayName}</b> (${item.ticker.toUpperCase()})\n  ${priceStr} (${changeStr} 24h)`;
  });

  const nowTs = now();
  const timeStr = nowTs.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

  await ctx.editMessageText(
    `📊 <b>Price Check</b> — ${timeStr}\n\n${lines.join("\n\n")}`,
    {
      parse_mode: "HTML",
      reply_markup: inlineKeyboard([
        [inlineButton("🔄 Refresh", "price:check")],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );

  // Update last prices.
  for (const priceData of prices) {
    const item = items.find((i) => i.coingeckoId === priceData.id);
    if (item) {
      await watchlistStore.updateLastPrice(userId, item.ticker, priceData.current_price);
    }
  }
});

export default composer;

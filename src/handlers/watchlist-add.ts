import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { watchlistStore, userStore, type WatchlistItem, now } from "../storage.js";

// CoinGecko search API for finding coins.
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

interface CoinSearchResult {
  id: string;
  symbol: string;
  name: string;
  market_cap_rank: number | null;
}

async function searchCoins(query: string): Promise<CoinSearchResult[]> {
  try {
    const params = new URLSearchParams({ query });
    const res = await fetch(`${COINGECKO_BASE}/search?${params}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { coins: CoinSearchResult[] };
    return data.coins.slice(0, 10); // Top 10 results.
  } catch {
    return [];
  }
}

// Popular coins for quick-add.
const POPULAR_COINS = [
  { id: "bitcoin", symbol: "btc", name: "Bitcoin" },
  { id: "ethereum", symbol: "eth", name: "Ethereum" },
  { id: "solana", symbol: "sol", name: "Solana" },
  { id: "cardano", symbol: "ada", name: "Cardano" },
  { id: "dogecoin", symbol: "doge", name: "Dogecoin" },
  { id: "polkadot", symbol: "dot", name: "Polkadot" },
  { id: "ripple", symbol: "xrp", name: "XRP" },
  { id: "avalanche-2", symbol: "avax", name: "Avalanche" },
];

const composer = new Composer<Ctx>();

// Watchlist add callback.
composer.callbackQuery("watchlist:add", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId) return;

  // Show popular coins and search option.
  const existingItems = await watchlistStore.getByUser(userId);
  const existingTickers = new Set(existingItems.map((i) => i.ticker.toLowerCase()));

  const popularButtons = POPULAR_COINS.filter(
    (coin) => !existingTickers.has(coin.symbol),
  ).map((coin) => [inlineButton(`${coin.name} (${coin.symbol.toUpperCase()})`, `add:${coin.id}`)]);

  if (popularButtons.length === 0) {
    await ctx.editMessageText(
      "➕ You've already added all popular coins!\n\nType a coin name to search for more.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    ctx.session.step = "watchlist:search";
    return;
  }

  await ctx.editMessageText(
    "➕ <b>Add Coin to Watchlist</b>\n\nChoose a popular coin or type a name to search.",
    {
      parse_mode: "HTML",
      reply_markup: inlineKeyboard([
        ...popularButtons.slice(0, 6),
        [inlineButton("🔍 Search for more...", "search:open")],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );
});

// Add coin by CoinGecko ID.
composer.callbackQuery(/^add:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId) return;

  const coinId = ctx.match[1];
  const coin = POPULAR_COINS.find((c) => c.id === coinId);
  if (!coin) {
    await ctx.answerCallbackQuery({ text: "Coin not found", show_alert: true });
    return;
  }

  const existing = await watchlistStore.get(userId, coin.symbol);
  if (existing) {
    await ctx.answerCallbackQuery({ text: "Already in your watchlist", show_alert: true });
    return;
  }

  const item: WatchlistItem = {
    userId,
    ticker: coin.symbol,
    displayName: coin.name,
    coingeckoId: coin.id,
    lastPrice: null,
    lastUpdated: null,
    addedAt: now().getTime(),
  };

  await watchlistStore.add(item);

  await ctx.editMessageText(
    `✅ <b>${coin.name}</b> (${coin.symbol.toUpperCase()}) added to your watchlist!`,
    {
      parse_mode: "HTML",
      reply_markup: inlineKeyboard([
        [inlineButton("➕ Add another", "watchlist:add")],
        [inlineButton("💰 Check prices", "price:check")],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );
});

// Search open callback.
composer.callbackQuery("search:open", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "watchlist:search";
  await ctx.editMessageText(
    "🔍 Type a coin name to search (e.g., \"Polygon\", \"Chainlink\").",
  );
});

// Handle search query.
composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "watchlist:search") return next();

  const query = ctx.message.text.trim();
  if (query.length < 2) {
    await ctx.reply("Type at least 2 characters to search.");
    return;
  }

  const results = await searchCoins(query);

  if (results.length === 0) {
    await ctx.reply(
      `No coins found for "${query}". Try a different name.`,
      {
        reply_markup: inlineKeyboard([
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }

  const userId = ctx.from?.id;
  if (!userId) return;

  const existingItems = await watchlistStore.getByUser(userId);
  const existingTickers = new Set(existingItems.map((i) => i.ticker.toLowerCase()));

  const buttons = results
    .filter((coin) => !existingTickers.has(coin.symbol))
    .slice(0, 8)
    .map((coin) => [
      inlineButton(
        `${coin.name} (${coin.symbol.toUpperCase()})${coin.market_cap_rank ? ` #${coin.market_cap_rank}` : ""}`,
        `add:${coin.id}`,
      ),
    ]);

  if (buttons.length === 0) {
    await ctx.reply(
      "All matching coins are already in your watchlist.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("🔍 Search again", "search:open")],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }

  await ctx.reply(
    `🔍 Results for "${query}":`,
    {
      reply_markup: inlineKeyboard([
        ...buttons,
        [inlineButton("🔍 Search again", "search:open")],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );
});

export default composer;

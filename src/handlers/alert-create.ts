import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { watchlistStore, alertStore, userStore, type AlertRule, now } from "../storage.js";

function generateAlertId(): string {
  return `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const composer = new Composer<Ctx>();

// Alert create callback.
composer.callbackQuery("alert:create", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId) return;

  const items = await watchlistStore.getByUser(userId);
  if (items.length === 0) {
    await ctx.editMessageText(
      "🔔 To set an alert, you need coins in your watchlist first.\n\nTap ➕ Add Coin to get started.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("➕ Add Coin", "watchlist:add")],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }

  // Show coins to choose from.
  const buttons = items.map((item) => [
    inlineButton(`${item.displayName} (${item.ticker.toUpperCase()})`, `alert:coin:${item.ticker}`),
  ]);

  await ctx.editMessageText(
    "🔔 <b>Set Price Alert</b>\n\nWhich coin do you want to set an alert for?",
    {
      parse_mode: "HTML",
      reply_markup: inlineKeyboard([
        ...buttons,
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );
});

// Coin selection for alert.
composer.callbackQuery(/^alert:coin:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId) return;

  const ticker = ctx.match[1];
  const item = await watchlistStore.get(userId, ticker);
  if (!item) {
    await ctx.answerCallbackQuery({ text: "Coin not found in watchlist", show_alert: true });
    return;
  }

  ctx.session.alertDraft = { ticker };

  await ctx.editMessageText(
    `🔔 <b>Alert for ${item.displayName}</b>\n\nWhat type of alert?`,
    {
      parse_mode: "HTML",
      reply_markup: inlineKeyboard([
        [inlineButton("📈 Price Threshold", `alert:type:threshold`)],
        [inlineButton("📊 Percentage Change", `alert:type:percentage`)],
        [inlineButton("Cancel", "menu:main")],
      ]),
    },
  );
});

// Alert type selection.
composer.callbackQuery(/^alert:type:(threshold|percentage)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId || !ctx.session.alertDraft) return;

  const alertType = ctx.match[1] as "threshold" | "percentage";
  ctx.session.alertDraft.alertType = alertType;

  const ticker = ctx.session.alertDraft.ticker;
  const item = await watchlistStore.get(userId, ticker!);

  if (alertType === "threshold") {
    await ctx.editMessageText(
      `🔔 <b>Price Threshold Alert</b>\n\nWhen should we notify you?`,
      {
        parse_mode: "HTML",
        reply_markup: inlineKeyboard([
          [inlineButton("⬆️ Price goes ABOVE", "alert:dir:above")],
          [inlineButton("⬇️ Price goes BELOW", "alert:dir:below")],
          [inlineButton("Cancel", "menu:main")],
        ]),
      },
    );
  } else {
    await ctx.editMessageText(
      `🔔 <b>Percentage Change Alert</b>\n\nNotify when price changes by how much?`,
      {
        parse_mode: "HTML",
        reply_markup: inlineKeyboard([
          [inlineButton("⬆️ Increases by", "alert:dir:above")],
          [inlineButton("⬇️ Decreases by", "alert:dir:below")],
          [inlineButton("Cancel", "menu:main")],
        ]),
      },
    );
  }
});

// Direction selection.
composer.callbackQuery(/^alert:dir:(above|below)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId || !ctx.session.alertDraft) return;

  const direction = ctx.match[1] as "above" | "below";
  ctx.session.alertDraft.direction = direction;

  const alertType = ctx.session.alertDraft.alertType;
  const ticker = ctx.session.alertDraft.ticker;
  const item = await watchlistStore.get(userId, ticker!);

  if (alertType === "threshold") {
    ctx.session.step = "alert:threshold:value";
    await ctx.editMessageText(
      `🔔 Price ${direction === "above" ? "above" : "below"} what value?\n\n` +
        (item?.lastPrice ? `Current price: $${item.lastPrice.toLocaleString()}\n` : "") +
        `Enter the price in USD (e.g., 50000).`,
    );
  } else {
    ctx.session.step = "alert:percentage:value";
    await ctx.editMessageText(
      `🔔 Percentage ${direction === "above" ? "increase" : "decrease"} threshold?\n\n` +
        `Enter the percentage (e.g., 5 for 5%).`,
    );
  }
});

// Threshold value input.
composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "alert:threshold:value" && ctx.session.step !== "alert:percentage:value") {
    return next();
  }

  const text = ctx.message.text.trim();
  const value = parseFloat(text);

  if (isNaN(value) || value <= 0) {
    await ctx.reply("Please enter a valid positive number.");
    return;
  }

  const userId = ctx.from?.id;
  if (!userId || !ctx.session.alertDraft) return;

  const draft = ctx.session.alertDraft;
  const item = await watchlistStore.get(userId, draft.ticker!);

  const alert: AlertRule = {
    id: generateAlertId(),
    userId,
    ticker: draft.ticker!,
    alertType: draft.alertType!,
    direction: draft.direction!,
    value,
    active: true,
    lastFired: null,
    createdAt: now().getTime(),
  };

  await alertStore.add(alert);

  ctx.session.step = undefined;
  ctx.session.alertDraft = undefined;

  const directionWord = draft.direction === "above" ? "above" : "below";
  const typeWord = draft.alertType === "threshold" ? `$${value.toLocaleString()}` : `${value}%`;

  await ctx.reply(
    `✅ <b>Alert Created!</b>\n\n` +
      `${item?.displayName ?? draft.ticker} (${draft.ticker!.toUpperCase()})\n` +
      `Notify when price goes ${directionWord} ${typeWord}`,
    {
      parse_mode: "HTML",
      reply_markup: inlineKeyboard([
        [inlineButton("🔔 Set another alert", "alert:create")],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );
});

// Show user's alerts.
composer.callbackQuery("alert:list", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId) return;

  const alerts = await alertStore.getByUser(userId);

  if (alerts.length === 0) {
    await ctx.editMessageText(
      "🔔 You have no alerts set.\n\nTap 🔔 Set Alert to create one.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("🔔 Set Alert", "alert:create")],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }

  const lines = alerts.map((alert) => {
    const direction = alert.direction === "above" ? "above" : "below";
    const value = alert.alertType === "threshold" ? `$${alert.value.toLocaleString()}` : `${alert.value}%`;
    const status = alert.active ? "✅" : "⏸️";
    return `${status} <b>${alert.ticker.toUpperCase()}</b> — ${direction} ${value}`;
  });

  await ctx.editMessageText(
    `🔔 <b>Your Alerts</b>\n\n${lines.join("\n")}`,
    {
      parse_mode: "HTML",
      reply_markup: inlineKeyboard([
        [inlineButton("🔔 Set another", "alert:create")],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );
});

export default composer;

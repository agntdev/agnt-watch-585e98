import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { registerMainMenuItem, inlineButton, inlineKeyboard, mainMenuKeyboard } from "../toolkit/index.js";
import { userStore, now, type UserProfile } from "../storage.js";

// Register menu items for all features.
registerMainMenuItem({ label: "➕ Add Coin", data: "watchlist:add", order: 10 });
registerMainMenuItem({ label: "💰 Check Price", data: "price:check", order: 20 });
registerMainMenuItem({ label: "🔔 Set Alert", data: "alert:create", order: 30 });
registerMainMenuItem({ label: "📊 My Watchlist", data: "watchlist:show", order: 40 });
registerMainMenuItem({ label: "👤 Owner Dashboard", data: "owner:metrics", order: 90 });

const WELCOME = "👋 Welcome to Crypto Watchlist Alerts!\n\nTrack your favorite cryptocurrencies and get notified when prices hit your targets.";

const TIMEZONE_OPTIONS = [
  { text: "UTC", data: "tz:UTC" },
  { text: "US Eastern", data: "tz:America/New_York" },
  { text: "US Central", data: "tz:America/Chicago" },
  { text: "US Pacific", data: "tz:America/Los_Angeles" },
  { text: "London", data: "tz:Europe/London" },
  { text: "Central European", data: "tz:Europe/Berlin" },
  { text: "Tokyo", data: "tz:Asia/Tokyo" },
  { text: "Sydney", data: "tz:Australia/Sydney" },
];

const composer = new Composer<Ctx>();

// /start command — show main menu.
composer.command("start", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  const profile = await userStore.get(userId);
  if (!profile) {
    // New user — start onboarding.
    ctx.session.step = "onboarding:timezone";
    ctx.session.onboarding = {};
    await ctx.reply(WELCOME + "\n\nFirst, what's your timezone?", {
      reply_markup: inlineKeyboard(
        TIMEZONE_OPTIONS.map((opt) => [inlineButton(opt.text, opt.data)]),
      ),
    });
    return;
  }

  // Existing user — show main menu.
  await ctx.reply(WELCOME, { reply_markup: mainMenuKeyboard() });
});

// Timezone selection during onboarding.
composer.callbackQuery(/^tz:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId || ctx.session.step !== "onboarding:timezone") return;

  const timezone = ctx.match[1];
  if (!ctx.session.onboarding) ctx.session.onboarding = {};
  ctx.session.onboarding.timezone = timezone;

  ctx.session.step = "onboarding:quiet_hours";
  await ctx.editMessageText(
    `✅ Timezone set to ${timezone}.\n\nNow, set your quiet hours — no alerts will be sent during this window.\n\nWhat time should quiet hours START? (e.g., 22:00)`,
  );
});

// Quiet hours start time.
composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "onboarding:quiet_hours") return next();

  const text = ctx.message.text.trim();
  const timeRegex = /^([01]?\d|2[0-3]):([0-5]\d)$/;
  const match = text.match(timeRegex);

  if (!match) {
    await ctx.reply("Please enter a valid time in HH:MM format (e.g., 22:00).");
    return;
  }

  if (!ctx.session.onboarding) ctx.session.onboarding = {};
  ctx.session.onboarding.quietHoursStart = text;

  ctx.session.step = "onboarding:quiet_hours_end";
  await ctx.reply(
    `✅ Quiet hours start at ${text}.\n\nWhat time should quiet hours END? (e.g., 07:00)`,
  );
});

// Quiet hours end time.
composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "onboarding:quiet_hours_end") return next();

  const text = ctx.message.text.trim();
  const timeRegex = /^([01]?\d|2[0-3]):([0-5]\d)$/;
  const match = text.match(timeRegex);

  if (!match) {
    await ctx.reply("Please enter a valid time in HH:MM format (e.g., 07:00).");
    return;
  }

  if (!ctx.session.onboarding) ctx.session.onboarding = {};
  ctx.session.onboarding.quietHoursEnd = text;

  ctx.session.step = "onboarding:summary";
  await ctx.reply(
    `✅ Quiet hours set: ${ctx.session.onboarding.quietHoursStart} – ${text}.\n\nWould you like a daily price summary?`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("✅ Yes, send daily summary", "summary:yes")],
        [inlineButton("❌ No, I'll check manually", "summary:no")],
      ]),
    },
  );
});

// Summary preference callback.
composer.callbackQuery(/^summary:(yes|no)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId || ctx.session.step !== "onboarding:summary") return;

  const enabled = ctx.match[1] === "yes";
  if (!ctx.session.onboarding) ctx.session.onboarding = {};
  ctx.session.onboarding.summaryEnabled = enabled;

  if (enabled) {
    ctx.session.step = "onboarding:summary_time";
    await ctx.editMessageText(
      "✅ Daily summary enabled!\n\nWhat time would you like to receive it? (e.g., 08:00)",
    );
  } else {
    // Complete onboarding.
    await completeOnboarding(ctx, userId);
  }
});

// Summary time input.
composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "onboarding:summary_time") return next();

  const text = ctx.message.text.trim();
  const timeRegex = /^([01]?\d|2[0-3]):([0-5]\d)$/;
  const match = text.match(timeRegex);

  if (!match) {
    await ctx.reply("Please enter a valid time in HH:MM format (e.g., 08:00).");
    return;
  }

  if (!ctx.session.onboarding) ctx.session.onboarding = {};
  ctx.session.onboarding.summaryTime = text;

  const userId = ctx.from?.id;
  if (!userId) return;

  await completeOnboarding(ctx, userId);
});

// Complete onboarding and save profile.
async function completeOnboarding(ctx: Ctx, userId: number): Promise<void> {
  const ob = ctx.session.onboarding;
  if (!ob) return;

  const profile: UserProfile = {
    chatId: ctx.chat?.id ?? userId,
    timezone: ob.timezone ?? "UTC",
    quietHoursStart: ob.quietHoursStart ?? "22:00",
    quietHoursEnd: ob.quietHoursEnd ?? "07:00",
    summaryTime: ob.summaryTime ?? "08:00",
    summaryEnabled: ob.summaryEnabled ?? false,
    cooldownMinutes: 30,
    onboardedAt: now().getTime(),
  };

  await userStore.set(userId, profile);

  ctx.session.step = undefined;
  ctx.session.onboarding = undefined;

  await ctx.reply(
    "✅ All set! Your watchlist is ready.\n\n" +
      "Tap a button below to get started:",
    { reply_markup: mainMenuKeyboard() },
  );
}

// Back to menu from any sub-view.
composer.callbackQuery("menu:main", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = undefined;
  ctx.session.onboarding = undefined;
  await ctx.editMessageText(WELCOME, { reply_markup: mainMenuKeyboard() });
});

// Show watchlist.
composer.callbackQuery("watchlist:show", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId) return;

  const { watchlistStore } = await import("../storage.js");
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

  const lines = items.map(
    (item) =>
      `• <b>${item.displayName}</b> (${item.ticker.toUpperCase()})` +
      (item.lastPrice ? ` — $${item.lastPrice.toLocaleString()}` : ""),
  );

  await ctx.editMessageText(
    `📊 <b>Your Watchlist</b>\n\n${lines.join("\n")}`,
    {
      parse_mode: "HTML",
      reply_markup: inlineKeyboard([
        [inlineButton("➕ Add Coin", "watchlist:add")],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );
});

export default composer;

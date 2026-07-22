import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";

const composer = new Composer<Ctx>();

const HELP =
  "ℹ️ <b>How to use Crypto Watchlist Alerts</b>\n\n" +
  "This bot tracks cryptocurrency prices and alerts you when they hit your targets.\n\n" +
  "<b>Getting started:</b>\n" +
  "• Tap /start to open the menu\n" +
  "• Add coins to your watchlist\n" +
  "• Set price alerts for each coin\n" +
  "• Check prices anytime\n\n" +
  "<b>Features:</b>\n" +
  "• ➕ Add Coin — track any cryptocurrency\n" +
  "• 💰 Check Price — see current prices and 24h changes\n" +
  "• 🔔 Set Alert — get notified when prices hit your targets\n" +
  "• 📊 My Watchlist — see all tracked coins\n" +
  "• 📅 Daily Summary — get a daily price report\n\n" +
  "<b>Alerts:</b>\n" +
  "• Price threshold — notify when price goes above/below a value\n" +
  "• Percentage change — notify when price changes by a %\n\n" +
  "Everything is controlled by buttons — just tap what you need.";

const backToMenu = inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]);

composer.command("help", async (ctx) => {
  await ctx.reply(HELP, { parse_mode: "HTML" });
});

composer.callbackQuery("menu:help", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(HELP, {
    parse_mode: "HTML",
    reply_markup: backToMenu,
  });
});

export default composer;

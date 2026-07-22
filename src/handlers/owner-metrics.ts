import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { userStore, alertStore, metricsStore, now } from "../storage.js";

// Owner authentication — set OWNER_USER_ID env var to your Telegram user ID.
function isOwner(userId: number): boolean {
  const ownerId = typeof process !== "undefined" ? process.env.OWNER_USER_ID : undefined;
  if (!ownerId) return false;
  return String(userId) === ownerId;
}

const composer = new Composer<Ctx>();

// Owner dashboard callback.
composer.callbackQuery("owner:metrics", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId) return;

  if (!isOwner(userId)) {
    await ctx.editMessageText(
      "🔒 Owner access required.\n\nSet the OWNER_USER_ID environment variable to your Telegram user ID.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }

  // Gather metrics.
  const userIds = await userStore.getAllIds();
  const totalUsers = userIds.length;

  // Count alerts and find top ones.
  const alertCounts = new Map<string, number>();
  for (const uid of userIds) {
    const alerts = await alertStore.getByUser(uid);
    for (const alert of alerts) {
      alertCounts.set(alert.ticker, (alertCounts.get(alert.ticker) ?? 0) + 1);
    }
  }

  const topAlerts = [...alertCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([ticker, count]) => ({ ticker, count }));

  const metrics = await metricsStore.get();
  const lastUpdated = new Date(metrics.lastUpdated);
  const updatedStr = lastUpdated.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Build report.
  let report = `📊 <b>Owner Dashboard</b>\n\n`;
  report += `👥 Active users: <b>${totalUsers}</b>\n`;
  report += `🔔 Total alerts: <b>${metrics.alertTriggers30d}</b> (30d)\n`;
  report += `📅 Last updated: ${updatedStr}\n`;

  if (topAlerts.length > 0) {
    report += `\n<b>Top 10 Alerts</b>\n`;
    for (let i = 0; i < topAlerts.length; i++) {
      const { ticker, count } = topAlerts[i];
      report += `${i + 1}. ${ticker.toUpperCase()} — ${count} alert${count !== 1 ? "s" : ""}\n`;
    }
  } else {
    report += `\nNo alerts set yet.`;
  }

  await ctx.editMessageText(report, {
    parse_mode: "HTML",
    reply_markup: inlineKeyboard([
      [inlineButton("🔄 Refresh", "owner:metrics")],
      [inlineButton("⬅️ Back to menu", "menu:main")],
    ]),
  });
});

export default composer;

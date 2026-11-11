import type { Context } from "./core/context.js";
import { foundation } from "./core/http.js";
import { commerceRoutes } from "./services/commerce.js";
import { providerRoutes } from "./services/provider.js";
import { deliveryRoutes } from "./services/delivery.js";
import { investigationRoutes } from "./services/investigation.js";
import { paymentRoutes } from "./services/payments.js";
import { operationsRoutes } from "./core/operations.js";
import { experienceRoutes } from "./services/experience.js";
export async function createApp(ctx: Context) {
  const app = await foundation(ctx);
  operationsRoutes(app, ctx);
  ({
    commerce: commerceRoutes,
    provider: providerRoutes,
    delivery: deliveryRoutes,
    investigation: investigationRoutes,
    payments: paymentRoutes,
  })[ctx.name](app, ctx);
  if (ctx.name === "commerce") experienceRoutes(app, ctx);
  await app.ready();
  return app;
}

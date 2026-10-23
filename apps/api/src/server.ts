import { app } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./services/logger.js";

app.listen(env.PORT, () => {
  logger.info("api_started", { port: env.PORT });
});

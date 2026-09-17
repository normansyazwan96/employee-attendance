import { app } from "./app.js";
import { env } from "./config/env.js";

app.listen(env.PORT, () => {
  console.info(`API listening at http://localhost:${env.PORT}`);
});

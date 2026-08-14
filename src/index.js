import "dotenv/config";
import app from "./app.js";
import { validateRuntimeConfig } from "./config/runtimeConfig.js";
import { initializeRateLimitStore } from "./config/rateLimitStore.js";

const PORT = process.env.PORT || 5000;
validateRuntimeConfig();
await initializeRateLimitStore();

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

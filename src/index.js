import "dotenv/config";
import app from "./app.js";
import { validateRuntimeConfig } from "./config/runtimeConfig.js";

const PORT = process.env.PORT || 5000;
validateRuntimeConfig();

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

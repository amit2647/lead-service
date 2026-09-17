const app = require("./app");

const PORT = process.env.PORT || 4001;

async function startServer() {
  try {
    console.log("[SERVER] Starting lead service...");

    app.listen(PORT, () => {
      console.log(`[SERVER] Lead service running on port ${PORT}`);
    });
  } catch (error) {
    console.error("[ERROR] Lead service startup failed");

    console.error(error);

    process.exit(1);
  }
}

startServer();

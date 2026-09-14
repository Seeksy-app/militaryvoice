import { app, log } from "./app.js";
import { serveStatic } from "./static.js";
import { createServer } from "node:http";

const httpServer = createServer(app);

(async () => {
  // Every real API route is registered by now. Anything still matching /api
  // is a route that does not exist, and it must say so — without this the
  // SPA fallback below answers it with index.html and a 200, so a typo or a
  // missing endpoint reaches the client as a page of HTML where JSON was
  // expected, and fails somewhere far away from the cause.
  app.use("/api", (req, res) => {
    res.status(404).json({ message: `No such endpoint: ${req.method} /api${req.path}` });
  });

  // importantly only setup vite in development; production serves the
  // pre-built static client bundle instead.
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();

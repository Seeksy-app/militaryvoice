// Vercel serverless entry point. Vercel's Node.js runtime auto-detects an
// exported Express app and wraps it as a request handler — no .listen() call
// needed (or wanted) here.
import app from "../server/app.js";

export default app;

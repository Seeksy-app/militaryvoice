import "dotenv/config";
import express, { Response, NextFunction } from "express";
import type { Request } from "express";
import { registerRoutes } from "./routes.js";

export const app = express();

// Vercel terminates TLS at its edge and forwards X-Forwarded-Proto. Trusting
// the proxy makes req.protocol report "https" so links we build for emails
// and third-party redirects (Upload-Post) don't come out as http://.
app.set("trust proxy", true);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "10mb" }));
// No other site may frame ours (clickjacking); vercel.json sets the same for static files.
app.use((_req, res, next) => {
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      // A long link segment after /invite/, /join/, /share-login/, /pay/ or /go/ is a credential: log it as :token.
      const shownPath = path.replace(/(\/(?:invite|join|share-login|pay|go)\/)[A-Za-z0-9_.~-]{16,}/gi, "$1:token");
      let logLine = `${req.method} ${shownPath} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        const body = JSON.stringify(capturedJsonResponse);
        // A response that hands out a token, key, code, secret or invite link is logged as its
        // status and size only (the status is already on this line), so no credential sits in the logs.
        const secret = /token|key|secret|password|passcode|code|link|invite|rtmp/i;
        // Every admin route (mail threads, sign-in codes, people) is hidden whatever it holds.
        const hidden = path.startsWith("/api/admin/") || secret.test(path) || /"[^"]*(token|key|secret|password|passcode|code|link|invite|rtmp)[^"]*"\s*:/i.test(body);
        logLine += hidden ? ` :: [response hidden, ${body.length} bytes]` : ` :: ${body}`;
      }

      log(logLine);
    }
  });

  next();
});

// Express 4 does not catch rejections from async handlers: one await that
// throws — a slow query hitting Postgres' statement timeout, say — becomes an
// unhandled rejection and takes the whole process down instead of failing that
// one request. Wrap every handler and middleware we register on a verb so it
// lands in the error middleware below. (requireAdmin does a DB lookup, so this
// covers the admin routes too.)
const ROUTE_VERBS = ["get", "post", "put", "patch", "delete"] as const;

function catchAsync(fn: unknown): unknown {
  if (typeof fn !== "function") return fn;
  const handler = fn as (...a: any[]) => any;
  if (handler.length >= 4) {
    return function (this: unknown, err: any, req: any, res: any, next: any) {
      try {
        return Promise.resolve(handler.call(this, err, req, res, next)).catch(next);
      } catch (e) {
        return next(e);
      }
    };
  }
  return function (this: unknown, req: any, res: any, next: any) {
    try {
      return Promise.resolve(handler.call(this, req, res, next)).catch(next);
    } catch (e) {
      return next(e);
    }
  };
}

for (const verb of ROUTE_VERBS) {
  const original = (app as any)[verb].bind(app);
  (app as any)[verb] = (...args: unknown[]) => original(...args.map(catchAsync));
}

registerRoutes(app);

app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  console.error("Internal Server Error:", err);

  if (res.headersSent) {
    return next(err);
  }

  return res.status(status).json({ message });
});

export default app;

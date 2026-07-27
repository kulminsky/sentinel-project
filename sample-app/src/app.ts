import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import express, { type Express } from "express";
import lodash from "lodash";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(moduleDirectory, "../..");
const publicDirectory = resolve(projectDirectory, "public");
const openApiPath = resolve(projectDirectory, "openapi.json");

const catalog = lodash.orderBy(
  [
    {
      id: "monitoring",
      name: "Monitoring",
      state: "operational",
    },
    {
      id: "reporting",
      name: "Reporting",
      state: "operational",
    },
  ],
  ["name"],
  ["asc"],
);

export function createApp(): Express {
  const app = express();

  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.get("/api/catalog", (_request, response) => {
    response.json({
      count: catalog.length,
      items: catalog,
    });
  });

  app.get("/api/profile", (_request, response) => {
    response.json({
      id: "account-demo",
      displayName: "Demo Operator",
    });
  });

  app.get("/api/public-feed", (_request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.json({
      items: ["Platform healthy", "Reports available"],
      visibility: "public",
    });
  });

  app.get("/api/slow", async (_request, response) => {
    await new Promise((resolveDelay) => {
      setTimeout(resolveDelay, 750);
    });

    response.json({ status: "complete" });
  });

  app.get("/debug/config", (_request, response) => {
    response.json({
      featureFlags: {
        compactDashboard: true,
      },
      mode: "debug",
      service: "sentinel-sample",
    });
  });

  app.get("/openapi.json", (_request, response) => {
    response.sendFile(openApiPath);
  });

  app.use(express.static(publicDirectory));

  return app;
}

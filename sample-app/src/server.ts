import { createApp } from "./app.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4310;

function readPort(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) {
    return DEFAULT_PORT;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(
      "SENTINEL_SAMPLE_PORT must be an integer from 1 through 65535.",
    );
  }

  return parsed;
}

const host =
  process.env.SENTINEL_SAMPLE_HOST?.trim().length === 0
    ? DEFAULT_HOST
    : (process.env.SENTINEL_SAMPLE_HOST ?? DEFAULT_HOST);
const port = readPort(process.env.SENTINEL_SAMPLE_PORT);
const app = createApp();

const server = app.listen(port, host, () => {
  console.log(`Sentinel sample app listening at http://${host}:${port}`);
});

server.on("error", () => {
  console.error("Sentinel sample app failed to start.");
  process.exitCode = 1;
});

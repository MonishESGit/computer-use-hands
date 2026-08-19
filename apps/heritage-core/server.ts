import { createApp } from "./app.js";

const port = Number(process.env.HC_PORT ?? 3401);
const host = "127.0.0.1";
const { app } = createApp();

app.listen(port, host, () => {
  process.stdout.write(
    `Heritage Core listening on http://${host}:${port}\n` +
      `  First Federal  http://${host}:${port}/t/first-federal/login\n` +
      `  Riverside      http://${host}:${port}/t/riverside/login\n`,
  );
});

// Loaded only by the automated test scripts, before fixture modules execute.
// Fixtures explicitly opt into pause/provider scenarios with synthetic settings.
for (const key of ["CONTENT_WRITES_PAUSED", "CONTENT_MODERATION_PROVIDER", "OPENAI_API_KEY"]) {
  delete process.env[key];
}

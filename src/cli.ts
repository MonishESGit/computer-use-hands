#!/usr/bin/env node

function usage(): void {
  process.stdout.write(
    [
      "hands — computer-use runtime",
      "",
      "Commands will be added as the runtime lands:",
      "  discover   LLM-driven run → capability artifact",
      "  replay     deterministic execution of a saved artifact",
      "  invoke     call a catalogued capability by name",
      "",
    ].join("\n"),
  );
}

usage();
process.exit(0);

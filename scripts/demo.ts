// Starts FixSight with sample results instead of the AI provider: free, offline,
// and clearly labelled in the app. Works the same on Windows, macOS, and Linux.
process.env.FIXSIGHT_DEMO_MODE = "true";
await import("../src/server.js");

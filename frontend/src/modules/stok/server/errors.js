import "server-only";

// A rule broken by the input. toActionResult shows its message as is, so it is always written in Turkish
// for the user. Same name as the settings module's class on purpose: toActionResult matches on the name.
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

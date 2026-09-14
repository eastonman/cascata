import { writeFixture } from "./fixture";

/**
 * Generates the fixture WAV rather than committing one.
 *
 * It is produced by the project's own encodeWav, so the encoder is exercised
 * by every run, and there is no binary in the repository to drift from the
 * code that reads it.
 */
export default function globalSetup(): void {
  writeFixture();
}

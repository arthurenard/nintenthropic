import { makeFixture } from "./fixture";

/** Before any browser starts: the fake camera's video must exist to be opened. */
export default async function globalSetup(): Promise<void> {
  await makeFixture();
}

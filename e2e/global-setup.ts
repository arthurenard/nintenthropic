import { makeFixture } from "./fixture";
import { makeSeatsFixtures } from "./seatsFixture";

/** Before any browser starts: the fake camera's videos must exist to be opened. */
export default async function globalSetup(): Promise<void> {
  await makeFixture();
  await makeSeatsFixtures();
}

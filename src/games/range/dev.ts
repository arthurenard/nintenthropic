/**
 * The Test Range's dev harness (src/dev/harness.ts), at
 * /src/games/range/dev.html: ?weapon=cylinder|magazine|heat, and Shift or
 * the right button for the scope.
 */
import { runHarness } from "../../dev/harness";
import { TEST_RANGE } from "./index";

void runHarness({ entry: TEST_RANGE, create: () => TEST_RANGE.create!() });

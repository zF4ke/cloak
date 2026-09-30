import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { withProjectLock } from "../src/core/lock.ts";
const directory = process.argv[2]!;
for (let i = 0; i < 8; i++)
  await withProjectLock(directory, async () => {
    const counter = join(directory, "counter");
    const value = Number(await readFile(counter, "utf8"));
    await setTimeout(5);
    await writeFile(counter, String(value + 1));
  });

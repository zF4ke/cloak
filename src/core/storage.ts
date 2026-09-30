import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
export class JsonStore<T> {
  private writes = Promise.resolve();
  constructor(
    private directory: string,
    private filename: string,
  ) {}
  async read(fallback: () => T): Promise<T> {
    try {
      return JSON.parse(
        await readFile(join(this.directory, this.filename), "utf8"),
      ) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error(
          `Could not read ${this.filename}. Repair it before continuing.`,
        );
      return fallback();
    }
  }
  async write(value: T) {
    const bytes = JSON.stringify(value, null, 2);
    const write = this.writes.then(async () => {
      await mkdir(this.directory, { recursive: true });
      const target = join(this.directory, this.filename),
        temporary = `${target}.${randomUUID()}.tmp`;
      await writeFile(temporary, bytes, { flag: "wx" });
      await rename(temporary, target);
    });
    this.writes = write.catch(() => {});
    await write;
  }
}

import { describe, expect, it } from "vitest";
import type { Driver, EngineKind } from "../src/drivers/types";
import { EngineOperations } from "../src/operations";
import { ConnectionRegistry } from "../src/registry";

class HangingDriver implements Driver {
  readonly kind: EngineKind = "sqlite";
  async connect(): Promise<void> {}
  async serverVersion(): Promise<string> {
    return "fake";
  }
  async query(): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
    return new Promise(() => {
      /* never resolves */
    });
  }
  async execute(): Promise<{ affectedRows: number }> {
    return { affectedRows: 0 };
  }
  async listTables(): Promise<string[]> {
    return [];
  }
  async describeTable(): Promise<{ columns: []; indexes: [] }> {
    return { columns: [], indexes: [] };
  }
  async ping(): Promise<boolean> {
    return true;
  }
  async close(): Promise<void> {}
}

describe("Connection timeout seam", () => {
  it("times out via an injected scheduler without waiting", async () => {
    let fired = false;
    const scheduler = {
      set: (fn: () => void) => {
        fired = true;
        queueMicrotask(fn);
        return 1;
      },
      clear: () => undefined,
    };
    const registry = new ConnectionRegistry({ driverFactory: () => new HangingDriver(), scheduler });
    const operations = new EngineOperations(registry);
    const open = await registry.open("sqlite:fake", { readOnly: true });

    await expect(operations.query(open.connection_id, "select 1")).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(fired).toBe(true);
    await registry.closeAll();
  });
});

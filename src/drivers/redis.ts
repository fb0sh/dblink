import { createClient, type RedisClientType } from "redis";
import { DblinkError } from "../errors.js";
import type { Driver, EngineKind } from "./types.js";

export class RedisDriver implements Driver {
  readonly kind: EngineKind = "redis";
  private client?: RedisClientType;

  constructor(private readonly dsn: string) {}

  async connect(): Promise<void> {
    const client = createClient({ url: this.dsn });
    client.on("error", () => {
      /* surfaced through ping / command failures */
    });
    await client.connect();
    this.client = client as unknown as RedisClientType;
    await this.client.ping();
  }

  private requireClient(): RedisClientType {
    if (!this.client) throw new DblinkError("CONN_CLOSED", "Redis connection is not open");
    return this.client;
  }

  async serverVersion(): Promise<string | undefined> {
    const info = (await this.requireClient().sendCommand(["INFO", "server"])) as string;
    const match = /redis_version:([^\r\n]+)/.exec(info);
    return match ? `redis ${match[1]}` : "redis";
  }

  async command(command: string, args: string[]): Promise<unknown> {
    return this.requireClient().sendCommand([command.toUpperCase(), ...args]);
  }

  async ping(): Promise<boolean> {
    try {
      await this.requireClient().ping();
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        await this.client.disconnect();
      }
      this.client = undefined;
    }
  }
}

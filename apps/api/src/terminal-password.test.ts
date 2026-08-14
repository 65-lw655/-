import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import { readHiddenPassword } from "./terminal-password.js";

class TestTerminalInput extends EventEmitter {
  isTTY = true;
  isRaw = false;
  readonly rawModes: boolean[] = [];

  setRawMode(mode: boolean): this {
    this.isRaw = mode;
    this.rawModes.push(mode);
    return this;
  }

  resume(): this {
    return this;
  }

  pause(): this {
    return this;
  }
}

function createOutput() {
  const writes: string[] = [];
  return {
    writes,
    stream: {
      write(chunk: string | Uint8Array) {
        writes.push(String(chunk));
        return true;
      }
    } as NodeJS.WriteStream
  };
}

function asInput(input: TestTerminalInput): NodeJS.ReadStream {
  return input as unknown as NodeJS.ReadStream;
}

describe("readHiddenPassword", () => {
  it("reads characters without echoing them and restores raw mode", async () => {
    const input = new TestTerminalInput();
    const output = createOutput();
    const secret = randomUUID();

    const reading = readHiddenPassword(
      "Password: ",
      asInput(input),
      output.stream
    );
    input.emit("data", Buffer.from(`${secret}\r`));

    await expect(reading).resolves.toBe(secret);
    expect(output.writes.join("")).toBe("Password: \n");
    expect(output.writes.join("")).not.toContain(secret);
    expect(input.rawModes).toEqual([true, false]);
  });

  it("removes one character for Backspace", async () => {
    const input = new TestTerminalInput();
    const output = createOutput();
    const secret = randomUUID();
    const discarded = randomUUID().slice(0, 1);

    const reading = readHiddenPassword(
      "Password: ",
      asInput(input),
      output.stream
    );
    input.emit("data", Buffer.from(`${secret}${discarded}\u007f\r`));

    await expect(reading).resolves.toBe(secret);
    expect(input.rawModes).toEqual([true, false]);
  });

  it("preserves a UTF-8 character split across input chunks", async () => {
    const input = new TestTerminalInput();
    const output = createOutput();
    const prefix = randomUUID();
    const character = Buffer.from("密");
    const reading = readHiddenPassword(
      "Password: ",
      asInput(input),
      output.stream
    );

    input.emit(
      "data",
      Buffer.concat([Buffer.from(prefix), character.subarray(0, 1)])
    );
    input.emit(
      "data",
      Buffer.concat([character.subarray(1), Buffer.from("\r")])
    );

    await expect(reading).resolves.toBe(`${prefix}密`);
    expect(output.writes.join("")).not.toContain(prefix);
  });

  it("rejects Ctrl+C and restores raw mode", async () => {
    const input = new TestTerminalInput();
    const output = createOutput();
    const reading = readHiddenPassword(
      "Password: ",
      asInput(input),
      output.stream
    );

    input.emit("data", Buffer.from("\u0003"));

    await expect(reading).rejects.toThrow("Password entry cancelled");
    expect(input.rawModes).toEqual([true, false]);
    expect(output.writes.join("")).toBe("Password: \n");
  });

  it("restores raw mode when the input stream fails", async () => {
    const input = new TestTerminalInput();
    const output = createOutput();
    const reading = readHiddenPassword(
      "Password: ",
      asInput(input),
      output.stream
    );

    input.emit("error", new Error("Terminal input failed"));

    await expect(reading).rejects.toThrow("Terminal input failed");
    expect(input.rawModes).toEqual([true, false]);
  });

  it("requires an interactive terminal", async () => {
    const input = new TestTerminalInput();
    input.isTTY = false;

    await expect(
      readHiddenPassword("Password: ", asInput(input), createOutput().stream)
    ).rejects.toThrow("Hidden password input requires a TTY");
    expect(input.rawModes).toEqual([]);
  });
});

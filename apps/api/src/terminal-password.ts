import { StringDecoder } from "node:string_decoder";

export async function readHiddenPassword(
  label: string,
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout
): Promise<string> {
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("Hidden password input requires a TTY");
  }

  const initialRawMode = input.isRaw ?? false;
  let rawModeChanged = false;
  let password = "";
  const decoder = new StringDecoder("utf8");
  output.write(label);

  let onData: ((chunk: Buffer | string) => void) | undefined;
  let onError: ((error: Error) => void) | undefined;
  try {
    input.setRawMode(true);
    rawModeChanged = true;
    input.resume();

    return await new Promise<string>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        output.write("\n");
        if (error === undefined) {
          resolve(password);
        } else {
          reject(error);
        }
      };

      onData = (chunk) => {
        const decoded =
          typeof chunk === "string" ? chunk : decoder.write(chunk);
        for (const character of Array.from(decoded)) {
          if (character === "\r" || character === "\n") {
            finish();
            return;
          }
          if (character === "\u0003") {
            finish(new Error("Password entry cancelled"));
            return;
          }
          if (character === "\u007f" || character === "\b") {
            const characters = Array.from(password);
            characters.pop();
            password = characters.join("");
            continue;
          }
          password += character;
        }
      };
      onError = (error) => finish(error);
      input.on("data", onData);
      input.on("error", onError);
    });
  } finally {
    if (onData !== undefined) {
      input.removeListener("data", onData);
    }
    if (onError !== undefined) {
      input.removeListener("error", onError);
    }
    input.pause();
    if (rawModeChanged) {
      input.setRawMode(initialRawMode);
    }
  }
}

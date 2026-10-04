import { readFile } from "node:fs/promises";

export async function loadScenario() {
  const raw = await readFile(
    new URL("../data/scenario/shaomai.json", import.meta.url),
    "utf8"
  );
  return JSON.parse(raw);
}

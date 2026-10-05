import { handleMessage } from "./basicTool.js";

const tests = ["what time is it?", "help", "find me a condo"];

for (const t of tests) {
  console.log(`> ${t}`);
  console.log(await handleMessage(t));
}

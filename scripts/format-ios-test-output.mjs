import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

const SUITE_RESULT = /^Test Suite '(.+)' (passed|failed) at /;
const TEST_RESULT = /^Test Case '-\[(.+?) (.+?)\]' (passed|failed)(?: \(([^)]+)\))?\.?$/;
const EXECUTED = /^\s*Executed \d+ tests?, with \d+ failures?/;
const FINAL_RESULT = /^\*\* TEST (SUCCEEDED|FAILED) \*\*$/;
const SWIFT_TEST_RESULT = /^[✔✘].+/;

export function formatIosTestLine(rawLine, color = false) {
  const line = rawLine.trim();
  const suite = line.match(SUITE_RESULT);
  if (suite) return paint(`${suite[2] === 'passed' ? '✓' : '✗'} suite ${suite[1]}`, suite[2], color);

  const test = line.match(TEST_RESULT);
  if (test) {
    const duration = test[4] ? ` (${test[4]})` : '';
    return paint(`${test[3] === 'passed' ? '✓' : '✗'} ${test[1]} › ${test[2]}${duration}`, test[3], color);
  }

  if (EXECUTED.test(line)) return line;

  const finalResult = line.match(FINAL_RESULT);
  if (finalResult) {
    const result = finalResult[1] === 'SUCCEEDED' ? 'passed' : 'failed';
    return paint(`${result === 'passed' ? '✓' : '✗'} iOS tests ${result}`, result, color);
  }

  if (SWIFT_TEST_RESULT.test(line)) return line;
  return null;
}

function paint(value, result, color) {
  if (!color) return value;
  const code = result === 'passed' ? 32 : 31;
  return `\u001B[${code}m${value}\u001B[0m`;
}

async function main() {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    const formatted = formatIosTestLine(line, process.stdout.isTTY);
    if (formatted) process.stdout.write(`${formatted}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();

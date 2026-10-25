/**
 * testdelta MCP server. Tool: diff_test_results.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runCheck, VERSION } from "./core.js";

const server = new McpServer({ name: "testdelta", version: VERSION });

server.tool(
  "diff_test_results",
  "Diff two test result sets from a directory containing base.json and head.json, each a JSON object mapping test names to pass, fail, or skip. Returns named regressions (pass to fail), fixes (fail to pass), added and removed tests, and a verdict of REGRESSED or NO-REGRESSION.",
  {
    path: z.string().describe("Target path to check"),
  },
  async ({ path }) => {
    const report = runCheck(path);
    return { content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }] };
  },
);

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();

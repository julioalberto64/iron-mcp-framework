import { callSecureApiTool } from "./call-secure-api.tool.js";
import { healthTool } from "./health.tool.js";
import { createGetSubscriberBalanceTool } from "./get-subscriber-balance.tool.js";

export function createTools() {
  return [healthTool, callSecureApiTool, createGetSubscriberBalanceTool()];
}

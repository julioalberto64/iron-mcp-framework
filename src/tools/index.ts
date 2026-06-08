import type { RestClient } from "../framework/rest/rest-client.js";
import { callSecureApiTool } from "./call-secure-api.tool.js";
import { healthTool } from "./health.tool.js";
import { createGetSubscriberBalanceTool } from "./get-subscriber-balance.tool.js";

export function createTools(restClient: RestClient) {
  return [healthTool, callSecureApiTool, createGetSubscriberBalanceTool(restClient)];
}

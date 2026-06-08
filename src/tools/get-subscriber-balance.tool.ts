import * as z from "zod/v4";

import type { RestClient } from "../framework/rest/rest-client.js";
import { defineTool } from "../framework/types.js";

const getSubscriberBalanceInputSchema = z.object({
  subscriberId: z.string().min(8).describe("Número de suscriptor. Ejemplo: 50230448966"),
});

export function createGetSubscriberBalanceTool(restClient: RestClient) {
  return defineTool({
    name: "get_subscriber_balance",
    title: "Get Subscriber Balance",
    description: "Consulta el balance de facturación de un suscriptor móvil Guatemala.",
    inputSchema: {
      subscriberId: z.string().min(8).describe("Número de suscriptor. Ejemplo: 50230448966"),
    },
    outputSchema: {
      invoiceId: z.string().optional(),
      dueAmount: z.number().optional(),
      dueAmountFormatted: z.string().optional(),
      dueDate: z.string().optional(),
      dueInvoicesCount: z.number().optional(),
      billingAccountId: z.string().optional(),
      paymentStatus: z.string().optional(),
      isDelinquent: z.boolean().optional(),
      raw: z.unknown(),
    },
    timeoutMs: 10000,
    idempotent: true,
    auth: {
      required: true,
      scopes: ["billing:read"],
    },
    audit: {
      category: "external-api",
      pii: true,
    },
    async handler(input) {
      const parsedInput = getSubscriberBalanceInputSchema.parse(input);

      const response = await restClient.get<{
        data?: {
          invoiceId?: { formattedValue?: string; value?: string };
          dueAmount?: { value?: number; formattedValue?: string };
          dueDate?: { formattedValue?: string; value?: string };
          dueInvoicesCount?: { value?: number };
          billingAccountId?: {
            formattedValue?: string;
            value?: string;
          };
          hasPayment?: {
            formattedValue?: string;
            value?: boolean;
          };
          isDelinquent?: {
            value?: boolean;
          };
        };
      }>(
        `/api/v2.0/mobile/billing/subscribers/${encodeURIComponent(
          parsedInput.subscriberId,
        )}/balance?_format=json`,
        {
          headers: {
            Referer: "https://juliomorales.dev/apirest/",
            Accept: "application/json, text/plain, */*",
          },
        },
      );

      const data = response.data;

      return {
        invoiceId: data?.invoiceId?.formattedValue ?? data?.invoiceId?.value,
        dueAmount: data?.dueAmount?.value,
        dueAmountFormatted: data?.dueAmount?.formattedValue,
        dueDate: data?.dueDate?.formattedValue ?? data?.dueDate?.value,
        dueInvoicesCount: data?.dueInvoicesCount?.value,
        billingAccountId: data?.billingAccountId?.formattedValue ?? data?.billingAccountId?.value,
        paymentStatus: data?.hasPayment?.formattedValue,
        isDelinquent: data?.isDelinquent?.value,
        raw: response,
      };
    },
  });
}

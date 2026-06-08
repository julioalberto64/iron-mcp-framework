export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode?: number;
  public readonly details?: unknown;

  public constructor(
    message: string,
    options: { code: string; statusCode?: number; details?: unknown },
  ) {
    super(message);
    this.name = new.target.name;
    this.code = options.code;

    if (options.statusCode !== undefined) {
      this.statusCode = options.statusCode;
    }

    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}

export class ConfigError extends AppError {
  public constructor(message: string, details?: unknown) {
    super(message, { code: "CONFIG_ERROR", details });
  }
}

export class AuthError extends AppError {
  public constructor(message: string, details?: unknown) {
    super(message, { code: "AUTH_ERROR", statusCode: 401, details });
  }
}

export class ApiError extends AppError {
  public constructor(message: string, statusCode: number, details?: unknown) {
    super(message, { code: "API_ERROR", statusCode, details });
  }
}

export class TimeoutError extends AppError {
  public constructor(message: string, details?: unknown) {
    super(message, { code: "TIMEOUT_ERROR", statusCode: 504, details });
  }
}

export function toSafeErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    return `${error.code}: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

import type { AppConfig } from "../config.js";
import { AuthError } from "../errors.js";

export interface AuthHeaderProvider {
  getHeaders(): Promise<Record<string, string>>;
}

export function createAuthHeaderProvider(config: AppConfig): AuthHeaderProvider {
  switch (config.auth.type) {
    case "none":
      return new NoAuthHeaderProvider();
    case "bearer-env":
      return new BearerTokenHeaderProvider(config.auth.token);
    case "api-key-env":
      return new ApiKeyHeaderProvider(config.auth.apiKeyHeader, config.auth.apiKey);
  }
}

class NoAuthHeaderProvider implements AuthHeaderProvider {
  public getHeaders(): Promise<Record<string, string>> {
    return Promise.resolve({});
  }
}

class BearerTokenHeaderProvider implements AuthHeaderProvider {
  public constructor(private readonly token: string | undefined) {}

  public getHeaders(): Promise<Record<string, string>> {
    if (this.token === undefined || this.token.trim() === "") {
      throw new AuthError("API_TOKEN no esta configurado para auth.type=bearer-env");
    }

    return Promise.resolve({
      Authorization: `Bearer ${this.token}`,
    });
  }
}

class ApiKeyHeaderProvider implements AuthHeaderProvider {
  public constructor(
    private readonly headerName: string | undefined,
    private readonly apiKey: string | undefined,
  ) {}

  public getHeaders(): Promise<Record<string, string>> {
    if (this.headerName === undefined || this.headerName.trim() === "") {
      throw new AuthError("API_KEY_HEADER no esta configurado para auth.type=api-key-env");
    }

    if (this.apiKey === undefined || this.apiKey.trim() === "") {
      throw new AuthError("API_KEY no esta configurado para auth.type=api-key-env");
    }

    return Promise.resolve({
      [this.headerName]: this.apiKey,
    });
  }
}

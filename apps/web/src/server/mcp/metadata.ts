import { appUrl } from "../email";
import { MCP_SCOPE } from "./oauth";

const base = () => appUrl("/").replace(/\/$/, "");

/** RFC 9728: tells MCP clients which authorization server protects /mcp. */
export const protectedResourceMetadata = () => ({
  resource: `${base()}/mcp`,
  authorization_servers: [base()],
  scopes_supported: [MCP_SCOPE],
  bearer_methods_supported: ["header"],
  resource_name: "Isocode Workspace (admins)",
});

/** RFC 8414 authorization server metadata. */
export const authorizationServerMetadata = () => ({
  issuer: base(),
  authorization_endpoint: `${base()}/team/oauth/authorize`,
  token_endpoint: `${base()}/api/oauth/token`,
  registration_endpoint: `${base()}/api/oauth/register`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
  scopes_supported: [MCP_SCOPE],
});

export const resourceMetadataUrl = () => `${base()}/.well-known/oauth-protected-resource/mcp`;

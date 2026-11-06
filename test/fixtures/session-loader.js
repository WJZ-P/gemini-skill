// Replace only the MCP server's browser session dependency; no browser or login is needed.
const serverUrl = new URL('../../src/mcp-server.js', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL === serverUrl && specifier === './index.js') {
    return {
      url: new URL('./fake-session.js', import.meta.url).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}

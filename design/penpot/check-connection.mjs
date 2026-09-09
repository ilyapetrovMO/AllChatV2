import {Client} from '../../.dev/penpot-mcp/packages/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StreamableHTTPClientTransport} from '../../.dev/penpot-mcp/packages/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
const config = await readFile(`${process.env.CODEX_HOME || homedir() + '/.codex'}/config.toml`, 'utf8');
const section = config.match(/^\[mcp_servers\.penpot\]\s*\n([^\[]*)/m)?.[1];
const address = section?.match(/^url\s*=\s*"([^"\n]+)"/m)?.[1];
if (!address) throw new Error('No Penpot MCP URL in the current Codex configuration');
const client = new Client({name: 'allchat-design-trial', version: '1.0.0'});
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(address)));
  const overview = await client.callTool({name: 'high_level_overview', arguments: {}});
  if (overview.isError) throw new Error(JSON.stringify(overview.content));
  const result = await client.callTool({name: 'execute_code', arguments: {code: 'return {file: penpot.currentFile ? {id: penpot.currentFile.id, name: penpot.currentFile.name} : null, page: penpot.currentPage?.name};'}}, undefined, {timeout: 15000});
  console.log(JSON.stringify(result, null, 2));
  if (result.isError || result.content?.some(item => item.type === 'text' && item.text.startsWith('Tool execution failed:'))) process.exitCode = 1;
} catch (error) {
  // Hosted URLs contain credentials; transport failures must not print them.
  let message = String(error.message).split(address).join('[Penpot endpoint]');
  for (const value of new URL(address).searchParams.values()) {
    if (value) message = message.split(value).join('[redacted]');
  }
  console.error(message);
  process.exitCode = 1;
} finally {
  await client.close();
}

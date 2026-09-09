import fs from 'node:fs/promises';
import {homedir} from 'node:os';
import {Client} from '../../.dev/penpot-mcp/packages/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StreamableHTTPClientTransport} from '../../.dev/penpot-mcp/packages/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
const config=await fs.readFile(`${process.env.CODEX_HOME||homedir()+'/.codex'}/config.toml`,'utf8');
const address=config.match(/^\[mcp_servers\.penpot\]\s*\n([^\[]*)/m)?.[1].match(/^url\s*=\s*"([^"\n]+)"/m)?.[1];
if(!address)throw Error('No configured Penpot URL');
const client=new Client({name:'allchat-login-prototype',version:'1.0.0'});
const sanitize=value=>{let s=String(value).split(address).join('[Penpot endpoint]');for(const v of new URL(address).searchParams.values())if(v)s=s.split(v).join('[redacted]');return s;};
async function execute(code){const result=await client.callTool({name:'execute_code',arguments:{code}},undefined,{timeout:60000});const value=result.content?.find(c=>c.type==='text')?.text;if(result.isError||!value||value.startsWith('Tool execution failed:'))throw Error(value||'Penpot execution failed');return JSON.parse(value).result;}
try{
 await client.connect(new StreamableHTTPClientTransport(new URL(address)));
 if(process.argv[2]==='execute'){
  const result=await execute(await fs.readFile(process.argv[3],'utf8'));
  if(process.argv[4])await fs.writeFile(process.argv[4],JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
 }else if(process.argv[2]==='preview'){
  const id=await execute(`return penpot.currentPage.root.children.find(s=>s.name===${JSON.stringify('Desktop / Login / Interaction / '+process.argv[3])})?.id;`);
  if(!id)throw Error('Prototype board missing');
  const result=await client.callTool({name:'export_shape',arguments:{shapeId:id,format:'png'}},undefined,{timeout:60000});
  const image=result.content?.find(c=>c.type==='image');if(!image)throw Error('No rendered image returned');
  await fs.writeFile(process.argv[4],Buffer.from(image.data,'base64'));console.log('Saved '+process.argv[4]);
 }else throw Error('Use execute CODE_FILE [RESULT_FILE], or preview STATE PNG_FILE');
}catch(e){console.error(sanitize(e.message));process.exitCode=1;}finally{await client.close();}

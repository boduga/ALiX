/** Linux-only SO_PEERCRED attestor. Native helper must be compiled and installed by trusted broker operator.
 * Prototype uses Node's undocumented socket._handle.fd; fail closed if unavailable.
 */
import {spawn} from 'node:child_process';
import type {Socket} from 'node:net';
import {assertTrustedPeercredHelper} from './worker-broker-trusted-helper.js';
import type {VerifiedBrokerPeer} from './worker-broker-ipc-boundary.js';

export function createLinuxPeerCredentialAttestor(helperPath:string, options?:{requireTrustedHelper?:boolean}) {
  if (process.platform!=='linux' || !helperPath.startsWith('/')) throw new Error('Linux peercred requires absolute trusted helper path');
  if(options?.requireTrustedHelper)assertTrustedPeercredHelper(helperPath);
  return async (socket:Socket):Promise<VerifiedBrokerPeer>=>{
    if(options?.requireTrustedHelper)assertTrustedPeercredHelper(helperPath);
    const fd=(socket as Socket & {_handle?:{fd?:number}})._handle?.fd;
    if (!Number.isSafeInteger(fd) || fd!<0 || socket.destroyed) throw new Error('Accepted Unix socket FD unavailable');
    return new Promise<VerifiedBrokerPeer>((resolve,reject)=>{
      const child=spawn(helperPath,[],{stdio:['ignore','pipe','pipe',fd!]});
      let output='';let error='';let settled=false;
      const finish=(err?:Error,peer?:VerifiedBrokerPeer)=>{if(settled)return;settled=true;clearTimeout(timer);if(err)reject(err);else resolve(peer!);};
      const timer=setTimeout(()=>{child.kill('SIGKILL');finish(new Error('Kernel peercred helper timeout'));},1000);
      timer.unref();
      child.stdout?.on('data',(chunk:Buffer)=>{output+=chunk.toString();if(output.length>128){child.kill('SIGKILL');finish(new Error('Oversized peercred response'));}});
      child.stderr?.on('data',(chunk:Buffer)=>{error+=chunk.toString().slice(0,128);});
      child.on('error',err=>finish(err));
      child.on('close',code=>{
        const match=/^(\d+) (\d+) (\d+)\n$/.exec(output);
        if(code!==0 || !match) return finish(new Error('Kernel peercred helper failed'));
        const pid=Number(match[1]);const uid=Number(match[2]);
        if(!Number.isSafeInteger(pid)||pid<1||!Number.isSafeInteger(uid)||uid<0)return finish(new Error('Invalid kernel peercred'));
        finish(undefined,{pid,uid,transport:'unix-peer-credentials'});
      });
    });
  };
}
